# Security Red-Teamer prototype

A small local review interface for the shared V5 LoRA adapter. It runs one Qwen3-4B model in three roles: Attacker, Critic, then Patcher only when the Critic confirms a finding.

## Important limits

- This is an experiment, not a security scanner or security gate. Your V5 held-out end-to-end evaluation was **4/12**.
- A “no finding” result does not establish that code is safe.
- The Patcher returns a suggestion only. The app never edits or applies code.
- Keep the app on its default local address. Do not enable public sharing for private source code.
- This prototype reviews short snippets, up to 6,000 characters.

## Files expected

Keep this layout:

    D:\projects\RedTeamer\
      app.py
      requirements.txt
      security-redteamer-qwen3-lora-v5\
        adapter_config.json
        adapter_model.safetensors
        tokenizer_config.json
        tokenizer.json

The adapter is not the complete model. The first load downloads the base model `Qwen/Qwen3-4B` from Hugging Face and combines it with the local adapter.

## Run on Windows

Use Python 3.13, which is installed on this PC. In PowerShell, from `D:\projects\RedTeamer`:

1. Create a virtual environment:

       py -3.13 -m venv .venv

2. Install a PyTorch build matching your computer. Use the official PyTorch selector at [pytorch.org/get-started/locally](https://pytorch.org/get-started/locally/). Select Windows and Pip, then choose the CUDA option that matches your NVIDIA setup. This PC has an RTX 4050 Laptop GPU with 6 GB VRAM. 4-bit loading may work for short snippets, but memory can be tight; if it runs out of memory, use the Colab T4, which has more headroom and is the known working setup from training.

3. Install the app libraries:

       .\.venv\Scripts\python.exe -m pip install -r requirements.txt

4. Start the app:

       .\.venv\Scripts\python.exe app.py

Open the local page shown in the terminal. Click **Load model** once, then paste a short snippet and click **Review code**. The first model load may take time and downloads several gigabytes.

To check whether PyTorch can see your GPU:

       .\.venv\Scripts\python.exe -c "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'No CUDA GPU')"

If it prints `False`, use the Colab T4 instead of attempting to run this 4-bit setup on CPU.

## Adapter location

By default, `app.py` loads:

    D:\projects\RedTeamer\security-redteamer-qwen3-lora-v5

To use another copy, set `REDTEAMER_ADAPTER` before starting the app:

       $env:REDTEAMER_ADAPTER = "D:\path\to\adapter"
       .\.venv\Scripts\python.exe app.py

The app uses the adapter tokenizer/chat template and asks Qwen for JSON. It stops the chain on invalid output, on “no finding,” or when the Critic does not confirm the report.
