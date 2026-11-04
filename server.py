import asyncio
import json
import os
import sys
from pathlib import Path
from typing import AsyncGenerator

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import app
import torch
import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

fastapi_app = FastAPI(title="Security Red-Teamer API", version="1.0.0")

fastapi_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_gpu_name() -> str:
    if torch.cuda.is_available():
        return torch.cuda.get_device_name(0)
    return "No CUDA GPU detected"


@fastapi_app.get("/api/model/status")
async def get_model_status():
    is_loaded = app._model is not None
    device = get_gpu_name() if is_loaded else (get_gpu_name() if torch.cuda.is_available() else "No GPU")
    return {
        "is_loaded": is_loaded,
        "device": device,
        "status": "ready" if is_loaded else "not_loaded",
        "adapters": ["shared_v5", "critic_v1", "patcher_v31"],
    }


@fastapi_app.post("/api/model/load")
async def post_model_load():
    try:
        await asyncio.to_thread(app.load_model)
        return {
            "status": "ready",
            "is_loaded": True,
            "device": get_gpu_name(),
            "adapters": {
                "attacker": str(app.ADAPTER_DIR),
                "critic": str(app.CRITIC_ADAPTER_DIR),
                "patcher": str(app.PATCHER_ADAPTER_DIR),
            },
        }
    except Exception as exc:
        return JSONResponse(
            status_code=500,
            content={"status": "error", "is_loaded": False, "detail": str(exc)},
        )


class ReviewPayload(BaseModel):
    code: str


async def review_event_stream(code: str) -> AsyncGenerator[str, None]:
    if not code or not code.strip():
        yield 'event: error\ndata: {"detail": "Paste a short code snippet first."}\n\n'
        return

    code = code.replace("\u00a0", " ").replace("\r\n", "\n").replace("\r", "\n")
    if len(code) > app.MAX_CODE_CHARS:
        yield f'event: error\ndata: {{"detail": "Snippet is too long ({len(code):,} chars, max {app.MAX_CODE_CHARS:,})."}}\n\n'
        return

    # Ensure model is ready
    if app._model is None:
        try:
            await asyncio.to_thread(app.load_model)
        except Exception as exc:
            yield f'event: error\ndata: {{"detail": "Failed to load model: {str(exc)}"}}\n\n'
            return

    # 1. Attacker Stage
    yield 'event: attacker_start\ndata: {"status": "running"}\n\n'
    await asyncio.sleep(0.02)

    try:
        raw_attacker = await asyncio.to_thread(
            app._generate, app._attacker_prompt(code), 700, "shared_v5"
        )
        attacker = app._extract_json(raw_attacker)
    except Exception as exc:
        yield f'event: error\ndata: {{"detail": "Attacker error: {str(exc)}"}}\n\n'
        return

    if not app._valid(
        attacker, "attacker", "status", {"finding", "no_finding", "needs_more_context"}
    ):
        yield f'event: error\ndata: {{"detail": "Attacker output was not valid JSON."}}\n\n'
        return

    if not isinstance(attacker.get("findings"), list) or not isinstance(
        attacker.get("missing_context"), list
    ):
        yield f'event: error\ndata: {{"detail": "Attacker output missing required lists."}}\n\n'
        return

    attacker_status = attacker["status"]
    attacker_for_critic = dict(attacker)
    attacker_for_display = dict(attacker)
    if attacker_status != "finding":
        attacker_for_display["findings"] = []

    yield f"event: attacker_done\ndata: {json.dumps(attacker_for_display, ensure_ascii=False)}\n\n"

    if attacker_status == "no_finding":
        yield 'event: complete\ndata: {"status": "done", "reason": "no_finding"}\n\n'
        return

    findings = attacker_for_critic["findings"]
    if attacker_status == "finding" and not findings:
        yield 'event: complete\ndata: {"status": "done", "reason": "empty_findings"}\n\n'
        return

    # 2. Critic Stage
    yield 'event: critic_start\ndata: {"status": "running"}\n\n'
    await asyncio.sleep(0.02)

    critic_report_input = app._format_report_for_critic(code, attacker_for_critic)
    try:
        raw_critic = await asyncio.to_thread(
            app._generate,
            app.build_user_critic(code, critic_report_input),
            500,
            "critic_v1",
            app.SPECIALIST_CRITIC_SYSTEM,
        )
        critic = app._extract_json(raw_critic)
    except Exception as exc:
        yield f'event: error\ndata: {{"detail": "Critic error: {str(exc)}"}}\n\n'
        return

    # Sanitize schema for 4B model quirks
    if isinstance(critic, dict):
        if "missing_context" not in critic or critic["missing_context"] is None:
            critic["missing_context"] = []
        if not isinstance(critic.get("cwe"), str):
            critic["cwe"] = str(critic.get("cwe") or "")
        if not isinstance(critic.get("reason"), str):
            critic["reason"] = str(critic.get("reason") or "")
        if not isinstance(critic.get("evidence"), str):
            critic["evidence"] = str(critic.get("evidence") or "")
        if critic.get("verdict") in {"confirmed", "rejected"} and isinstance(
            critic.get("missing_context"), list
        ):
            cleaned = [
                x
                for x in critic["missing_context"]
                if x and str(x).lower().strip() not in {"none", "n/a", "no", "null"}
            ]
            if not cleaned:
                critic["missing_context"] = []

    if not app.valid_critic_schema(critic):
        yield f'event: error\ndata: {{"detail": "Critic output did not pass schema check."}}\n\n'
        return

    gate = app.critic_gate(critic, code, critic_report_input)
    critic_display = dict(critic)
    critic_display["gate"] = {
        "proceed_to_patcher": gate["proceed_to_patcher"],
        "evidence_grounded": gate["evidence_grounded"],
        "missing_context_grounded": gate["missing_context_grounded"],
    }

    yield f"event: critic_done\ndata: {json.dumps(critic_display, ensure_ascii=False)}\n\n"

    if not gate["proceed_to_patcher"]:
        yield 'event: complete\ndata: {"status": "done", "reason": "critic_halted"}\n\n'
        return

    # 3. Patcher Stage
    yield 'event: patcher_start\ndata: {"status": "running"}\n\n'
    await asyncio.sleep(0.02)

    raw_f0 = findings[0] if findings else critic_report_input
    patcher_finding = app._format_finding_for_patcher(code, raw_f0, critic)
    try:
        raw_patcher = await asyncio.to_thread(
            app._generate,
            app.build_patcher_user(code, patcher_finding),
            900,
            "patcher_v31",
            app.SPECIALIST_PATCHER_SYSTEM,
        )
        patcher = app._extract_json(raw_patcher)
    except Exception as exc:
        yield f'event: error\ndata: {{"detail": "Patcher error: {str(exc)}"}}\n\n'
        return

    if not app.valid_patcher_schema(patcher):
        yield f'event: error\ndata: {{"detail": "Patcher output did not pass schema check."}}\n\n'
        return

    try:
        patcher = app.finalize_patcher_output(patcher, code, patcher_finding)
    except Exception as exc:
        yield f'event: error\ndata: {{"detail": "Patcher validation error: {str(exc)}"}}\n\n'
        return

    # 1-shot repair if needed
    if patcher.get("failed_checks") and any(
        str(check).startswith("edits_apply:") for check in patcher["failed_checks"]
    ):
        repair_prompt = (
            app.build_patcher_user(code, patcher_finding)
            + "\n<validation_feedback>\n"
            + "Your previous edit was rejected because its old text did not match an exact, unique span in the source. "
            + "Re-read the source and copy the old lines exactly, preserving all quotes, operators, and indentation. "
            + "JSON-escape quotes as needed so the parsed old value is identical to the source. Do not guess. "
            + "If you cannot produce an exact, unique edit, return no_patch.\n"
            + "</validation_feedback>"
        )
        try:
            raw_retry = await asyncio.to_thread(
                app._generate,
                repair_prompt,
                900,
                "patcher_v31",
                app.SPECIALIST_PATCHER_SYSTEM,
            )
            retry_candidate = app._extract_json(raw_retry)
            if app.valid_patcher_schema(retry_candidate):
                patcher = app.finalize_patcher_output(
                    retry_candidate, code, patcher_finding
                )
                patcher["repair_attempted"] = True
            else:
                patcher["repair_attempted"] = True
                patcher["repair_retry"] = {
                    "status": "invalid_schema",
                    "raw_output": raw_retry,
                }
        except Exception as exc:
            patcher["repair_attempted"] = True
            patcher["repair_retry"] = {"status": "error", "reason": str(exc)}

    yield f"event: patcher_done\ndata: {json.dumps(patcher, ensure_ascii=False)}\n\n"
    yield 'event: complete\ndata: {"status": "done"}\n\n'


@fastapi_app.post("/api/review")
async def post_review(payload: ReviewPayload):
    return StreamingResponse(
        review_event_stream(payload.code),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


if __name__ == "__main__":
    uvicorn.run("server:fastapi_app", host="127.0.0.1", port=8000, reload=False)

