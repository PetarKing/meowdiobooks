"""Language capability and normalization for the pinned Qwen voice pipeline."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .model_config import load_model_registry


LANGUAGE_ALIASES = {
    "zh": "chinese",
    "chinese": "chinese",
    "mandarin": "chinese",
    "en": "english",
    "english": "english",
    "de": "german",
    "german": "german",
    "it": "italian",
    "italian": "italian",
    "pt": "portuguese",
    "portuguese": "portuguese",
    "es": "spanish",
    "spanish": "spanish",
    "ja": "japanese",
    "japanese": "japanese",
    "ko": "korean",
    "korean": "korean",
    "fr": "french",
    "french": "french",
    "ru": "russian",
    "russian": "russian",
}

AUDITION_TEMPLATES = {
    "chinese": (
        "这是{name}的声音。明亮的清晨，轻柔的微风吹过宁静的村庄。"
        "广场后方的一扇门打开了，急促的脚步声穿过石板路。"
        "随后，一个清晰的声音喊道：‘等等——有件事你必须听。’"
    ),
    "english": (
        "This is the voice of {name}. "
        "The bright morning carried a gentle breeze across the quiet village. "
        "A door opened somewhere behind the square, and hurried footsteps crossed the stones. "
        "Then a clear voice called, ‘Wait—there is something you need to hear.’"
    ),
    "french": (
        "Voici la voix de {name}. "
        "Ce matin lumineux, une brise légère traversait le village paisible. "
        "Une porte s’ouvrit derrière la place, et des pas pressés résonnèrent sur les pavés. "
        "Puis une voix claire appela : « Attendez — il faut que vous entendiez quelque chose. »"
    ),
    "german": (
        "Dies ist die Stimme von {name}. "
        "Am hellen Morgen wehte eine sanfte Brise durch das ruhige Dorf. "
        "Hinter dem Platz öffnete sich eine Tür, und eilige Schritte hallten über das Pflaster. "
        "Dann rief eine klare Stimme: ‚Warte — du musst etwas hören.‘"
    ),
    "italian": (
        "Questa è la voce di {name}. "
        "Nel mattino luminoso, una brezza leggera attraversava il tranquillo villaggio. "
        "Una porta si aprì dietro la piazza e passi frettolosi attraversarono le pietre. "
        "Poi una voce limpida chiamò: «Aspetta — c’è qualcosa che devi sentire.»"
    ),
    "japanese": (
        "これは{name}の声です。明るい朝、穏やかな風が静かな村を吹き抜けました。"
        "広場の向こうで扉が開き、急ぐ足音が石畳を渡ってきました。"
        "そして澄んだ声が呼びかけました。『待って――聞いてほしいことがあります。』"
    ),
    "korean": (
        "이것은 {name}의 목소리입니다. 밝은 아침, 부드러운 바람이 고요한 마을을 스쳐 갔습니다. "
        "광장 뒤편에서 문이 열리고 다급한 발걸음이 돌길을 가로질렀습니다. "
        "그때 또렷한 목소리가 외쳤습니다. ‘잠깐만요—꼭 들어야 할 이야기가 있어요.’"
    ),
    "portuguese": (
        "Esta é a voz de {name}. "
        "Na manhã luminosa, uma brisa suave atravessou a vila tranquila. "
        "Uma porta se abriu atrás da praça, e passos apressados cruzaram as pedras. "
        "Então uma voz clara chamou: «Espere — há algo que você precisa ouvir.»"
    ),
    "russian": (
        "Говорит {name}. Ясным утром лёгкий ветерок прошёл по тихой деревне. "
        "За площадью открылась дверь, и торопливые шаги застучали по камням. "
        "Затем ясный голос позвал: «Подожди — тебе нужно кое-что услышать»."
    ),
    "spanish": (
        "Esta es la voz de {name}. "
        "En la mañana luminosa, una brisa suave recorrió el tranquilo pueblo. "
        "Una puerta se abrió detrás de la plaza y unos pasos apresurados cruzaron las piedras. "
        "Entonces una voz clara llamó: «Espera — hay algo que necesitas oír.»"
    ),
}

SHARED_AUDITION_TEMPLATES = {
    "chinese": "明亮的清晨，轻柔的微风吹过宁静的村庄。广场后方的一扇门打开了，急促的脚步声穿过石板路。随后，一个清晰的声音喊道：‘等等——有件事你必须听。’",
    "english": (
        "The bright morning carried a gentle breeze across the quiet village. "
        "A door opened somewhere behind the square, and hurried footsteps crossed the stones. "
        "Then a clear voice called, ‘Wait—there is something you need to hear.’"
    ),
    "french": (
        "Ce matin lumineux, une brise légère traversait le village paisible. "
        "Une porte s’ouvrit derrière la place, et des pas pressés résonnèrent sur les pavés. "
        "Puis une voix claire appela : « Attendez — il faut que vous entendiez quelque chose. »"
    ),
    "german": (
        "Am hellen Morgen wehte eine sanfte Brise durch das ruhige Dorf. "
        "Hinter dem Platz öffnete sich eine Tür, und eilige Schritte hallten über das Pflaster. "
        "Dann rief eine klare Stimme: ‚Warte — du musst etwas hören.‘"
    ),
    "italian": (
        "Nel mattino luminoso, una brezza leggera attraversava il tranquillo villaggio. "
        "Una porta si aprì dietro la piazza e passi frettolosi attraversarono le pietre. "
        "Poi una voce limpida chiamò: «Aspetta — c’è qualcosa che devi sentire.»"
    ),
    "japanese": (
        "明るい朝、穏やかな風が静かな村を吹き抜けました。"
        "広場の向こうで扉が開き、急ぐ足音が石畳を渡ってきました。"
        "そして澄んだ声が呼びかけました。『待って――聞いてほしいことがあります。』"
    ),
    "korean": (
        "밝은 아침, 부드러운 바람이 고요한 마을을 스쳐 갔습니다. "
        "광장 뒤편에서 문이 열리고 다급한 발걸음이 돌길을 가로질렀습니다. "
        "그때 또렷한 목소리가 외쳤습니다. ‘잠깐만요—꼭 들어야 할 이야기가 있어요.’"
    ),
    "portuguese": (
        "Na manhã luminosa, uma brisa suave atravessou a vila tranquila. "
        "Uma porta se abriu atrás da praça, e passos apressados cruzaram as pedras. "
        "Então uma voz clara chamou: «Espere — há algo que você precisa ouvir.»"
    ),
    "russian": (
        "Ясным утром лёгкий ветерок прошёл по тихой деревне. "
        "За площадью открылась дверь, и торопливые шаги застучали по камням. "
        "Затем ясный голос позвал: «Подожди — тебе нужно кое-что услышать»."
    ),
    "spanish": (
        "En la mañana luminosa, una brisa suave recorrió el tranquilo pueblo. "
        "Una puerta se abrió detrás de la plaza y unos pasos apresurados cruzaron las piedras. "
        "Entonces una voz clara llamó: «Espera — hay algo que necesitas oír.»"
    ),
}

def normalize_language(value: object) -> str:
    """Return the Qwen language code for a model-proposed name/code, if known."""
    return LANGUAGE_ALIASES.get(str(value or "").strip().casefold(), "")


def audition_line(name: str, language: object) -> str:
    """Return the deterministic comparison line in the selected synthesis language."""
    normalized = normalize_language(language)
    template = AUDITION_TEMPLATES.get(normalized)
    if template is None:
        raise ValueError(f"Unsupported audition language: {language}")
    return template.format(name=name)


def shared_audition_line(language: object) -> str:
    """Return a neutral comparison line that can be shown for several cast identities."""

    normalized = normalize_language(language)
    template = SHARED_AUDITION_TEMPLATES.get(normalized)
    if template is None:
        raise ValueError(f"Unsupported audition language: {language}")
    return template


def supported_voice_languages(
    repo_root: Path, model_id: str | None = None
) -> set[str]:
    """Return the declared languages for one selectable cast-audition model."""
    pipeline = load_model_registry(repo_root).voice_pipeline(model_id)
    return set(pipeline.languages)


def voice_model_capabilities(repo_root: Path) -> list[dict[str, Any]]:
    """Expose installed audition models and their own language capabilities."""
    registry = load_model_registry(repo_root)
    pipelines = sorted(
        registry.voice_pipelines.values(),
        key=lambda pipeline: pipeline.id != registry.default_voice_id,
    )
    return [
        {
            "id": pipeline.id,
            "label": pipeline.label,
            "supportedLanguages": sorted(pipeline.languages),
        }
        for pipeline in pipelines
    ]


def representative_language_sample(pages: list[dict[str, Any]], limit: int = 4000) -> str:
    """Select deterministic text from opening, middle, and closing pages for language detection."""
    if not pages:
        return ""
    indexes = sorted({0, len(pages) // 2, len(pages) - 1})
    parts = [str(pages[index].get("text", "")).strip() for index in indexes]
    return "\n\n".join(part for part in parts if part)[:limit]


def infer_language(pages: list[dict[str, Any]]) -> str:
    """Infer a safe audition default from representative book text.

    Script-specific languages are identified first. Latin-script books default to
    English; the user still makes the final choice before any audio is generated.
    """
    sample = representative_language_sample(pages)
    if not sample:
        return "english"
    ranges = {
        "chinese": sum("\u4e00" <= char <= "\u9fff" for char in sample),
        "japanese": sum("\u3040" <= char <= "\u30ff" for char in sample),
        "korean": sum("\uac00" <= char <= "\ud7af" for char in sample),
        "russian": sum("\u0400" <= char <= "\u04ff" for char in sample),
    }
    language, count = max(ranges.items(), key=lambda row: row[1])
    letters = sum(char.isalpha() for char in sample)
    return language if count >= max(8, letters // 5) else "english"
