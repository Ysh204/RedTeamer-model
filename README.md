# Security Red-Teamer Prototype

A local review interface for a three-stage security review flow. The app uses
the shared V5 adapter for Attacker and Critic, then switches to the Patcher
specialist adapter only after the Critic confirms a finding. It loads one
Qwen3-4B base model and attaches both LoRA adapters to it.

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
  patcher_agent/
    patcher_v31_export/
      adapter/
        adapter_config.json
        adapter_model.safetensors
        tokenizer_config.json
        tokenizer.json
```

The Patcher runtime source at
`patcher_agent/patcher_v31_export/patcher_runtime.py` is tracked in Git; only
the local `adapter/` export is ignored. The first app load downloads the
Qwen3-4B base model from Hugging Face if it is not already in the Hugging Face
cache. Both adapters use that same base model.

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

By default, the app loads the shared Attacker/Critic adapter from
`security-redteamer-qwen3-lora-v5` and the specialist Patcher adapter from
`patcher_agent/patcher_v31_export/adapter`, both relative to the repository
root.

To use adapter copies at other paths, set these variables before starting the
app:

```powershell
$env:REDTEAMER_ADAPTER = "D:\path\to\shared_adapter"
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
still does not match.

These checks are not a security proof. Evidence alignment is unassessed when
the Attacker paraphrases instead of quoting source text exactly. Every
proposal requires human review and regression testing; the app never applies
it.
