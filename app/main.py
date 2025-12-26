from __future__ import annotations

import json
import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal

import requests
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, validator
from starlette.requests import Request

APP_ROOT = Path(__file__).resolve().parent.parent
PRESETS_PATH = APP_ROOT / "data" / "presets" / "presets.json"

app = FastAPI(title="Rename Me")
app.mount("/static", StaticFiles(directory=APP_ROOT / "static"), name="static")
templates = Jinja2Templates(directory=APP_ROOT / "templates")


class DeleteTransform(BaseModel):
    type: Literal["delete"] = "delete"
    needle: str


class ExtractTransform(BaseModel):
    type: Literal["extract"] = "extract"
    pattern: str
    template: str


class OrderTransform(BaseModel):
    type: Literal["order"] = "order"
    start: int = 1


class ImdbTransform(BaseModel):
    type: Literal["imdb"] = "imdb"
    imdb_id: str


class PaddingTransform(BaseModel):
    type: Literal["padding"] = "padding"
    side: Literal["before", "after"] = "before"
    length: int = 0
    char: str = "0"


TransformModel = Annotated[
    DeleteTransform | ExtractTransform | OrderTransform | ImdbTransform | PaddingTransform,
    Field(discriminator="type"),
]


class PreviewRequest(BaseModel):
    directory: str
    transforms: list[TransformModel]

    @validator("directory", pre=True)
    def normalize_directory(cls, value: str) -> str:
        return os.path.abspath(os.path.expanduser(value))


class ApplyRequest(PreviewRequest):
    pass


class PresetSaveRequest(BaseModel):
    name: str
    transforms: list[TransformModel]


@dataclass
class FileState:
    original: str
    base: str
    ext: str


def list_files(directory: str) -> list[str]:
    if not os.path.isdir(directory):
        raise HTTPException(status_code=400, detail="Directory not found")
    entries = []
    for entry in os.scandir(directory):
        if entry.is_file():
            entries.append(entry.name)
    return sorted(entries, key=str.lower)


def split_name(filename: str) -> FileState:
    base, ext = os.path.splitext(filename)
    return FileState(original=filename, base=base, ext=ext)


def render_template(template: str, groups: tuple[str, ...]) -> str:
    def replace(match: re.Match[str]) -> str:
        index = int(match.group(1))
        if 1 <= index <= len(groups):
            return groups[index - 1]
        return ""

    return re.sub(r"\$(\d+)", replace, template)


def apply_delete(states: list[FileState], transform: DeleteTransform) -> None:
    needle = transform.needle
    if not needle:
        return
    for state in states:
        state.base = state.base.replace(needle, "")


def apply_extract(states: list[FileState], transform: ExtractTransform) -> None:
    try:
        pattern = re.compile(transform.pattern)
    except re.error as exc:
        raise HTTPException(status_code=400, detail=f"Regex invalide: {exc}")
    for state in states:
        match = pattern.search(state.base)
        if match:
            state.base = render_template(transform.template, match.groups())


def apply_order(states: list[FileState], transform: OrderTransform) -> None:
    sorted_states = sorted(states, key=lambda s: (s.base + s.ext).lower())
    counter = transform.start
    for state in sorted_states:
        state.base = str(counter)
        counter += 1


def apply_padding(states: list[FileState], transform: PaddingTransform) -> None:
    length = max(0, transform.length)
    pad_char = (transform.char or "0")[:1]
    if length <= 0:
        return
    for state in states:
        if len(state.base) >= length:
            continue
        padding = pad_char * (length - len(state.base))
        if transform.side == "after":
            state.base = f"{state.base}{padding}"
        else:
            state.base = f"{padding}{state.base}"


def fetch_imdb_episodes(imdb_id: str) -> list[str]:
    imdb_id = imdb_id.strip()
    if not imdb_id.startswith("tt"):
        raise HTTPException(status_code=400, detail="L'identifiant IMDb doit commencer par tt")

    session = requests.Session()
    session.headers.update({
        "User-Agent": "RenameMe/1.0",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
    })

    tvmaze_lookup = session.get(
        f"https://api.tvmaze.com/lookup/shows?imdb={imdb_id}",
        timeout=15,
    )
    if tvmaze_lookup.status_code == 200:
        show = tvmaze_lookup.json()
        show_id = show.get("id")
        if show_id:
            episodes_response = session.get(
                f"https://api.tvmaze.com/shows/{show_id}/episodes",
                timeout=15,
            )
            if episodes_response.status_code == 200:
                episodes_payload = episodes_response.json()
                episodes = []
                for entry in episodes_payload:
                    season = entry.get("season")
                    number = entry.get("number")
                    if isinstance(season, int) and isinstance(number, int):
                        episodes.append(f"S{season:02d}E{number:02d}")
                if episodes:
                    return episodes

    seasons_url = f"https://www.imdb.com/title/{imdb_id}/episodes"
    response = session.get(seasons_url, timeout=15)
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Impossible de recuperer IMDb")

    def parse_episode_pairs(html: str) -> list[tuple[int, int]]:
        patterns = [
            r"data-season-number=\"(\d+)\"[^>]*data-episode-number=\"(\d+)\"",
            r"data-episode-number=\"(\d+)\"[^>]*data-season-number=\"(\d+)\"",
            r"S(\d+),\s*Ep(\d+)",
            r"\"seasonNumber\"\\s*:\\s*(\\d+).*?\"episodeNumber\"\\s*:\\s*(\\d+)",
        ]
        pairs: list[tuple[int, int]] = []
        for pattern in patterns:
            for match in re.finditer(pattern, html, re.DOTALL):
                if pattern.startswith("data-episode-number"):
                    episode = int(match.group(1))
                    season = int(match.group(2))
                else:
                    season = int(match.group(1))
                    episode = int(match.group(2))
                pairs.append((season, episode))
            if pairs:
                break
        return pairs

    season_matches = re.findall(r"data-season=\"(\d+)\"", response.text)
    if not season_matches:
        season_matches = re.findall(r"season=(\d+)\"", response.text)
    if not season_matches:
        season_matches = re.findall(r"<option value=\"(\d+)\"", response.text)
    if not season_matches:
        season_matches = re.findall(r"\"seasonNumber\"\\s*:\\s*(\\d+)", response.text)
    seasons = sorted({int(value) for value in season_matches})
    if not seasons:
        pairs = parse_episode_pairs(response.text)
        if pairs:
            episodes = [f"S{season:02d}E{episode:02d}" for season, episode in pairs]
            return episodes
        raise HTTPException(status_code=404, detail="Aucune saison trouvee")

    episodes: list[str] = []
    seen_pairs: set[tuple[int, int]] = set()
    for season in seasons:
        url = f"https://www.imdb.com/title/{imdb_id}/episodes?season={season}"
        season_response = session.get(url, timeout=15)
        if season_response.status_code != 200:
            continue
        pairs = parse_episode_pairs(season_response.text)
        if pairs:
            for pair_season, pair_episode in pairs:
                if pair_season != season:
                    continue
                key = (pair_season, pair_episode)
                if key in seen_pairs:
                    continue
                seen_pairs.add(key)
                episodes.append(f"S{pair_season:02d}E{pair_episode:02d}")
            continue
        episode_numbers = re.findall(r"data-episode-number=\"(\d+)\"", season_response.text)
        if not episode_numbers:
            episode_numbers = re.findall(r"\"episodeNumber\"\\s*:\\s*(\\d+)", season_response.text)
        for episode in episode_numbers:
            episode_num = int(episode)
            key = (season, episode_num)
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            episodes.append(f"S{season:02d}E{episode_num:02d}")

    if not episodes:
        raise HTTPException(status_code=404, detail="Aucun episode trouve")
    return episodes


def apply_imdb(states: list[FileState], transform: ImdbTransform) -> list[str]:
    episodes = fetch_imdb_episodes(transform.imdb_id)
    sorted_states = sorted(states, key=lambda s: (s.base + s.ext).lower())
    missing = []
    for index, state in enumerate(sorted_states):
        if index >= len(episodes):
            missing.append(state.original)
            continue
        state.base = episodes[index]
    return missing


def apply_transforms(
    filenames: list[str],
    transforms: list[TransformModel],
) -> tuple[list[dict[str, str | bool]], list[str], list[str]]:
    states = [split_name(name) for name in filenames]
    imdb_missing: list[str] = []

    for transform in transforms:
        if isinstance(transform, DeleteTransform):
            apply_delete(states, transform)
        elif isinstance(transform, ExtractTransform):
            apply_extract(states, transform)
        elif isinstance(transform, OrderTransform):
            apply_order(states, transform)
        elif isinstance(transform, PaddingTransform):
            apply_padding(states, transform)
        elif isinstance(transform, ImdbTransform):
            imdb_missing = apply_imdb(states, transform)

    preview = []
    unchanged = []
    for state in states:
        new_name = f"{state.base}{state.ext}"
        changed = new_name != state.original
        preview.append({
            "original": state.original,
            "proposed": new_name,
            "changed": changed,
        })
        if not changed:
            unchanged.append(state.original)
    return preview, unchanged, imdb_missing


def ensure_presets_path() -> None:
    PRESETS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not PRESETS_PATH.exists():
        PRESETS_PATH.write_text("{}", encoding="utf-8")


def read_presets() -> dict[str, list[dict[str, object]]]:
    ensure_presets_path()
    with PRESETS_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_presets(presets: dict[str, list[dict[str, object]]]) -> None:
    ensure_presets_path()
    with PRESETS_PATH.open("w", encoding="utf-8") as handle:
        json.dump(presets, handle, indent=2)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/files")
async def api_files(directory: str) -> dict[str, list[str]]:
    files = list_files(directory)
    return {"files": files}


@app.post("/api/preview")
async def api_preview(payload: PreviewRequest) -> dict[str, object]:
    files = list_files(payload.directory)
    preview, unchanged, imdb_missing = apply_transforms(files, payload.transforms)
    return {
        "preview": preview,
        "unchanged": unchanged,
        "imdb_missing": imdb_missing,
    }


@app.post("/api/apply")
async def api_apply(payload: ApplyRequest) -> dict[str, object]:
    files = list_files(payload.directory)
    preview, unchanged, imdb_missing = apply_transforms(files, payload.transforms)

    proposed_names = [item["proposed"] for item in preview]
    if len(set(proposed_names)) != len(proposed_names):
        raise HTTPException(status_code=409, detail="Conflit: des fichiers auraient le meme nom")

    mapping = {item["original"]: item["proposed"] for item in preview}
    directory = payload.directory

    temp_mapping: dict[str, str] = {}
    for original, proposed in mapping.items():
        if original == proposed:
            continue
        temp_name = f".renameme-{uuid.uuid4().hex}{Path(original).suffix}"
        temp_mapping[original] = temp_name

    errors: list[str] = []
    successful = 0
    final_mapping: dict[str, str] = {}
    for original, temp_name in temp_mapping.items():
        try:
            os.rename(os.path.join(directory, original), os.path.join(directory, temp_name))
            final_mapping[original] = temp_name
        except OSError as exc:
            errors.append(f"{original}: {exc}")

    for original, temp_name in final_mapping.items():
        final_name = mapping[original]
        try:
            os.rename(os.path.join(directory, temp_name), os.path.join(directory, final_name))
            successful += 1
        except OSError as exc:
            errors.append(f"{original}: {exc}")

    return {
        "total": len(files),
        "renamed": successful,
        "unchanged": unchanged,
        "imdb_missing": imdb_missing,
        "errors": errors,
    }


@app.get("/api/presets")
async def api_list_presets() -> dict[str, list[str]]:
    presets = read_presets()
    return {"presets": sorted(presets.keys())}


@app.get("/api/presets/{name}")
async def api_get_preset(name: str) -> dict[str, object]:
    presets = read_presets()
    if name not in presets:
        raise HTTPException(status_code=404, detail="Preset introuvable")
    return {"name": name, "transforms": presets[name]}


@app.post("/api/presets")
async def api_save_preset(payload: PresetSaveRequest) -> dict[str, str]:
    presets = read_presets()
    presets[payload.name] = json.loads(payload.json())["transforms"]
    write_presets(presets)
    return {"status": "ok"}


@app.delete("/api/presets/{name}")
async def api_delete_preset(name: str) -> dict[str, str]:
    presets = read_presets()
    if name not in presets:
        raise HTTPException(status_code=404, detail="Preset introuvable")
    presets.pop(name)
    write_presets(presets)
    return {"status": "ok"}
