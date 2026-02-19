# Browser-Local Headline Summarization – Hybrid Strategy Specification

## Objective

Generate a short descriptive headline from a paragraph of text using **fully local, in-browser AI**, with:

- Zero server inference cost
- Minimal bundle size
- Maximum performance on capable devices
- Graceful fallback for unsupported environments

---

# High-Level Architecture

## Strategy Overview (Progressive Enhancement)

1. **Primary Path (Tier 1):**
   Use the browser’s built-in Summarizer API (Chrome / Edge).

2. **Secondary Path (Tier 2):**
   Use a WebGPU-based in-browser LLM runtime with a small quantized model.

3. **Final Fallback (Tier 3):**
   Use a lightweight extractive heuristic (no ML) if WebGPU is unavailable.

---

# Tier 1 – Browser Built-in Summarizer API

## Goal
Use the browser’s native on-device summarization model when available.

## Requirements

- Feature-detect availability at runtime.
- Must not crash if API is unavailable.
- Must not block UI if model downloads on first use.

## Behavior

Input:
- Plain text paragraph (≤ 2,000 characters recommended)

Output:
- Single short headline (5–12 words)
- No punctuation at end unless necessary
- No quotes
- Title case preferred

## Prompting Strategy

If API allows configuration, enforce:
- Style: "headline"
- Length: "short"
- Tone: "neutral"

If freeform prompting is required:

> "Summarize the following text into a short, descriptive headline. Output only the headline."

## Performance Expectations

- Near-native performance
- Zero model download handled by app
- Zero infrastructure cost

## Failure Conditions

Fallback if:
- API not supported
- Permission denied
- Runtime error
- User offline and model not cached

---

# Tier 2 – WebGPU Local Model Runtime

## Runtime Requirements

- WebGPU support required
- Use a WebGPU LLM runtime (e.g., MLC/WebLLM-style architecture)
- Lazy-load model only when needed

## Model Specifications

### Target Size

- 1B–3B parameter instruction-tuned model
- Quantized to 4-bit (preferred) or 8-bit
- Model size target: 500MB–1.2GB

### Why This Size?

- Good balance of:
  - Quality
  - Download size
  - Inference latency
- Larger models dramatically increase load time
- Smaller (<1B) models degrade headline quality noticeably

## Context Requirements

- Minimum 2K token context window
- Input truncation required if exceeding limit

## Prompt Template