# Security Red-Teamer Prototype

A local review interface for a three-stage security review flow. The app uses
the shared V5 adapter for the Attacker, the specialist Critic v1 adapter for
independent verification, and the specialist Patcher v3.1 adapter for proposing
code fixes after confirmation. It loads one Qwen3-4B base model and attaches all
three LoRA adapters to it.

## Limits

- This is an experimental review aid, not a security scanner or security gate.
- The V5 held-out end-to-end evaluation was 4/12. A “no finding” result does
  not establish that code is safe.
- The Patcher proposes edits and a diff. The app never changes project files.
- Generic checks do not prove a vulnerability is fixed. Review every
  proposal and run appropriate regression tests before applying it.
- Keep the app on its default local address. Do not expose it publicly or
  paste production secrets into it.
- The app reviews Python snippets up to 6,000 characters.

## Model files

Git contains the application and runtime code, but not the adapter exports or
base-model weights. The adapter directories are ignored by `.gitignore`.
Obtain the complete adapter exports from your team’s approved model or file
storage, then place them here:

```text
<repo root>/
  security-redteamer-qwen3-lora-v5/
    adapter_config.json
    adapter_model.safetensors
    tokenizer_config.json
    tokenizer.json
  critic_agent/
    critic_v1_export/
      adapter/
        adapter_config.json
        adapter_model.safetensors
        tokenizer_config.json
        tokenizer.json
  patcher_agent/
    patcher_v31_export/
      adapter/
        adapter_config.json
        adapter_model.safetensors
        tokenizer_config.json
        tokenizer.json
```

The Critic and Patcher runtime sources at
`critic_agent/critic_v1_export/critic_runtime.py` and
`patcher_agent/patcher_v31_export/patcher_runtime.py` are tracked in Git; only
the local `adapter/` exports are ignored. The first app load downloads the
Qwen3-4B base model from Hugging Face if it is not already in the Hugging Face
cache. All adapters use that same base model.

## Run on Windows

Run these steps from the cloned repository root.

1. Create a virtual environment:

   ```powershell
   py -3.13 -m venv .venv
   ```

2. Install a PyTorch build that matches your NVIDIA GPU and CUDA setup. Use
   the selector at [pytorch.org/get-started/locally](https://pytorch.org/get-started/locally/).
   The app loads the base in 4-bit mode. A 6 GB GPU may run out of memory;
   use a Colab T4 or another supported GPU if that happens.

3. Install the remaining app libraries:

   ```powershell
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

4. If you want the Hugging Face cache inside the repository, set its path and
   sign in if your account requires it:

   ```powershell
   $env:HF_HOME = "$PWD\.hf_cache"
   .\.venv\Scripts\hf.exe auth login
   ```

   The cache and credentials are excluded from Git. Do not paste access
   tokens into source files or commit them.

5. Start the app:

   ```powershell
   .\.venv\Scripts\python.exe app.py
   ```

Open the local address shown by Gradio, click **Load model**, then paste a
short Python snippet and click **Review code**. The first model load may take
time if the base weights are not cached.

To check whether PyTorch can see the GPU:

```powershell
.\.venv\Scripts\python.exe -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'No CUDA GPU')"
```

## Adapter locations

By default, the app loads:
- Attacker: `security-redteamer-qwen3-lora-v5`
- Critic specialist: `critic_agent/critic_v1_export/adapter`
- Patcher specialist: `patcher_agent/patcher_v31_export/adapter`

All paths are relative to the repository root.

To use adapter copies at other paths, set these variables before starting the
app:

```powershell
$env:REDTEAMER_ADAPTER = "D:\path\to\shared_adapter"
$env:REDTEAMER_CRITIC_ADAPTER = "D:\path\to\critic_adapter"
$env:REDTEAMER_PATCHER_ADAPTER = "D:\path\to\patcher_adapter"
```

## Review flow and safeguards

Attacker reports a finding, no finding, or a need for more context. Critic
reviews the report against the visible code. Patcher runs only when Attacker
reports a concrete finding and Critic confirms it. Patcher returns exact
`old`/`new` edit blocks; the app checks that they match the snippet, creates a
unified diff, and performs generic checks for patch applicability, Python
parsing, new undefined names, and patch size. If an edit does not match the
source, the app retries once with validator feedback and rejects it if it
still does not match. As a narrow recovery for malformed JSON quoting, it can
replace quote characters in an `old` block only when the rest of the complete
block matches exactly one source span; the adjusted edit is disclosed for
human review. Other mismatches and ambiguous spans are rejected.

These checks are not a security proof. Evidence alignment is unassessed when
the Attacker paraphrases instead of quoting source text exactly. Every
proposal requires human review and regression testing; the app never applies
it.
