# AI Security Red-Teamer: Training History and Model Details

This document records the training work completed for the AI Security Red-Teamer prototype, how the dataset and model changed from V1 through V5, which settings are confirmed by the run logs, and what remains planned. It distinguishes measured results from goals and unverified configuration details.

## 1. Current architecture at a glance

The prototype uses Qwen/Qwen3-4B as its base model. The main V5 adapter was trained on examples for all three roles: Attacker, Critic, and Patcher. The Gradio application runs those roles sequentially with different prompts. The Patcher is only called after a finding is confirmed. The application never applies a patch to files.

There is also a separate Critic-only LoRA adapter from an experiment. There are not yet three separately trained role-specific adapters. Attacker-only and Patcher-only adapters are planned work.

| Item | Current state |
|---|---|
| Base model | Qwen/Qwen3-4B |
| Main adapter | Shared V5 adapter trained on Attacker, Critic, and Patcher examples |
| Specialist experiment | A separate Critic-only adapter |
| Separate Attacker adapter | Not trained yet |
| Separate Patcher adapter | Not trained yet |
| App behavior | One model runs sequential role prompts; patch proposals are suggestions only |

The adapter is not a full copy of Qwen3-4B. To run it, the base model is loaded and the LoRA adapter is attached.

## 2. Dataset design

The project dataset was custom-curated as JSONL; the run history does not identify a named public dataset. Rows use conversational messages formatted for the Qwen chat template and include fields such as case ID, category, agent, and messages.

Each security case is represented for three tasks:

1. **Attacker:** Report a supported finding, report no finding, or request more context. The target report includes evidence and, when appropriate, a CWE, severity, confidence, impact, safe validation guidance, and missing context.
2. **Critic:** Confirm, reject, or request more context for the candidate finding, with a reason, evidence, and missing context.
3. **Patcher:** Propose a defensive patch and regression-test ideas, or return no patch.

The examples cover vulnerable code, safe lookalikes and false positives, and ambiguous cases that depend on unseen helper functions, middleware, configuration, or dependency versions. Categories across the dataset versions include SQL injection, XSS, command injection, path traversal, SSRF, authorization, CSRF, insecure deserialization, password and token handling, TLS and cookie configuration, open redirects, secrets, and dependency context.

The dataset was split by case so related Attacker, Critic, and Patcher rows for a case stayed in the same split. This helps prevent examples of the same scenario from appearing in both training and validation.

### Dataset growth and splits

| Version | Curated cases | Rows | Recorded split or purpose |
|---|---:|---:|---|
| V1 | 3 examples | 3 examples | Tiny pipeline baseline; not a meaningful security benchmark |
| V2 | 34 cases | 102 rows | 22 train cases, 6 validation cases, 6 test cases |
| V3 | 44 cases | 132 rows | 27 train cases, 7 validation cases, 10 test cases |
| V4 | 58 cases | 174 rows | 47 train cases, 11 validation cases; a separate fresh 10-case test set |
| V5 | 80 cases | 240 rows | 64 train cases, 16 validation cases; a separate fresh 12-case test set |

For V5, each split contained all three agent rows per case:

- Training: 64 cases, 192 rows (64 per agent).
- Validation: 16 cases, 48 rows (16 per agent).
- Fresh test: 12 cases, balanced across four expected findings, four safe cases, and four context-dependent cases.

The V5 training-candidate label totals were:

| Role | Label totals across 80 cases |
|---|---|
| Attacker | 32 finding, 34 no_finding, 14 needs_more_context |
| Critic | 32 confirmed, 34 rejected, 14 needs_more_context |
| Patcher | 32 patch_proposed, 48 no_patch |

The V5 training split had 26 confirmed, 27 rejected, and 11 needs-more-context Critic examples. The validation split had 6 confirmed, 7 rejected, and 3 needs-more-context examples.

The separate V5 test set had 4 examples for each Attacker outcome and each Critic verdict; its Patcher labels were 4 patch proposals and 8 no-patch outcomes. The test set was initially created with no overlap with the V5 candidate. After its outputs were inspected and used to guide prompt and development changes, treat it as a development benchmark rather than a pristine blind test for future comparisons. Create a new untouched test set for the next model comparison.

## 3. Version-by-version training and upgrades

### V1 — Pipeline baseline

- Started with only three training examples and three epochs.
- Confirmed that Qwen3-4B could be loaded in 4-bit form, a LoRA adapter could be attached, and the adapter could be saved to Drive.
- Saved the baseline separately at security-redteamer-qwen3-lora.
- The adapter configuration showed rank 8, alpha 16, dropout 0.05, and the projection targets listed in the training-parameter section below.
- This was a proof that the workflow ran, not evidence of useful security performance. The dataset was far too small for reliable conclusions.

### V2 — Structured three-role dataset and first evaluation

- Expanded the custom dataset to 34 cases and 102 rows, with one row per agent for each case.
- Split by case into 22 training, 6 validation, and 6 held-out test cases.
- Used assistant-only supervised loss with the Qwen chat format after discovering earlier formatting and masking issues.
- Trained for three epochs. The best reported validation loss was about 1.178; held-out test loss was about 0.984 and mean token accuracy about 0.786.
- These are next-token language-model metrics, not vulnerability-detection accuracy. Early generations also exposed weak Critic behavior on false positives.

### V3 — More scenarios, clearer labels, and explicit context cases

- Grew to 44 cases and 132 rows.
- Split into 27 training cases (81 rows), 7 validation cases (21 rows), and 10 test cases (30 rows).
- Added and normalized examples for positive findings, safe lookalikes, and needs-more-context scenarios across the three roles.
- Trained for five epochs. Best validation loss was about 0.740 and mean token accuracy about 0.842.
- On the ten-case evaluation, the corrected status/verdict grading showed Attacker exact status on 7/10, Critic exact verdict on 3/10, and Patcher exact status on 9/10 when called. The end-to-end pipeline was exact on 6/10 in that run.
- The evaluation exposed false Critic confirmations on rejected cases and motivated more balanced, explicit Critic examples.

### V4 — Corrections based on V3 errors

- Created a V4 working copy, then added reviewed examples to reach 58 cases and 174 rows.
- Split into 47 training cases (141 rows) and 11 validation cases (33 rows). A separate fresh test set contained 10 cases.
- The dataset more directly represented safe code, real findings, and ambiguous cases. The training run retained all 141 train and 33 validation rows with assistant loss.
- Trained for five epochs. Best validation loss was about 0.667; mean token accuracy was about 0.848.
- The ten-case end-to-end evaluation was exact on 6/10. It found some safe cases correctly but missed several findings and context-dependent cases.
- The missed cases were reviewed and used to create corrected examples for V5. Consequently, V4’s test cases are not all independent of the later V5 training data.

### V5 — Larger balanced dataset and Critic specialist experiment

- Expanded the candidate to 80 cases and 240 rows, including examples reviewed after V4.
- Used 64 training cases and 16 validation cases, with all three role rows kept together per case. Created a separate 12-case test set with four finding, four safe, and four context-dependent cases.
- Trained the shared adapter for five epochs, using assistant-only loss and a maximum sequence length of 1024.
- The run reported training loss about 0.894, best validation loss about 0.555, and mean token accuracy about 0.864. Training took about 1,261 seconds on the Colab Tesla T4.
- These token metrics improved over earlier runs, but the datasets and splits changed across versions, so validation-loss numbers are not a controlled apples-to-apples comparison.
- A separate Critic-only adapter was trained on 76 Critic training rows and 16 Critic validation rows for five epochs. Its best validation loss was about 0.687 and mean token accuracy about 0.838. It was saved separately at security-redteamer-qwen3-critic-lora-v1.
- In the latest 12-case comparison, Attacker exact status was 4/12; shared Critic exact verdict was 7/12; Critic-specialist exact verdict was 7/12; and the end-to-end pipeline was exact on 4/12. Results varied across earlier runs and prompt configurations, so report the run and configuration alongside any score.

## 4. Confirmed model and fine-tuning parameters

The saved V5 adapter configuration in the local project confirms the base model and LoRA settings below. Training logs confirm the precision, length, epoch count, and assistant-only loss behavior.

| Parameter | Confirmed setting |
|---|---|
| Base model | Qwen/Qwen3-4B |
| Base-model parameter count | 4,038,983,168, approximately 4.04 billion |
| LoRA method | PEFT LoRA for causal language modeling |
| LoRA rank | r = 8 |
| LoRA alpha | 16 |
| LoRA dropout | 0.05 |
| LoRA target modules | q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj |
| Trainable parameters | 16,515,072, approximately 0.4089% of the reported total |
| Base-model loading | 4-bit BitsAndBytes loading |
| Trainer precision | FP16 enabled; BF16 disabled |
| Trainable adapter tensor dtype after the fix | FP32 |
| Maximum sequence length | 1024 tokens |
| V5 shared training epochs | 5 |
| Loss target | Assistant completion only; user/prompt tokens masked |
| Trainer | TRL SFTTrainer |
| Logged package versions | TRL 1.17.0, Transformers 5.22.1, PEFT 0.21.2 |
| Main training GPU | Google Colab Tesla T4 |

An earlier run failed because BF16 gradients reached an AMP gradient-unscaling operation that did not support them in that setup. The training configuration was corrected so adapter parameters were FP32 and the trainer used FP16 with BF16 disabled; the later runs completed.

The V5 training run printed 120 optimizer steps across five epochs. The Critic-only run printed 95 steps across five epochs.

### Settings not verified in the available run logs

The training notebook/configuration cell was not present in the local project folder, and the run summaries do not record exact values for:

- Learning rate.
- Per-device batch size and gradient-accumulation steps.
- Optimizer and scheduler.
- Weight decay, random seed, or exact warmup-step count.

The training write-up draft says NF4 and double quantization were enabled. The available run summary confirms 4-bit loading but does not independently verify those two BitsAndBytes flags. Check the original Colab BitsAndBytesConfig before presenting them as confirmed.

The SFTConfig compatibility check reported assistant-only loss, packing, max length, and warmup_steps support; warmup_ratio was not accepted by the installed TRL version. The precise warmup_steps value is not recorded here.

## 5. Training objective and inference are different

Fine-tuning was supervised fine-tuning (SFT): for each conversational example, the model learned to predict the assistant’s reference response. Assistant-only masking was used so the model was not trained to reproduce the user prompt as a target.

The app uses greedy generation (do_sample=False) for its role outputs. Inference generation limits and the application prompts are separate from training hyperparameters. The Critic and Patcher are sequential prompt-controlled tasks; their outputs are not independent model votes.

## 6. Planned next architecture: one base model, three role adapters

The planned specialization route is:

- Keep the same Qwen3-4B base model.
- Train an Attacker-only LoRA adapter from Attacker rows.
- Train a Critic-only LoRA adapter from Critic rows.
- Train a Patcher-only LoRA adapter from Patcher rows.
- Switch the active adapter by stage in the app, while keeping the shared V5 adapter as a baseline for comparison.

For a fair experiment, use identical case IDs in the train and validation split across all three role adapters, identical model/training settings, and a newly created test set that is not used to change prompts or examples. The existing Critic-only adapter is an early specialist experiment; retraining all role adapters from a common split would make comparison cleaner.

## 7. What the prototype does and does not demonstrate

The prototype demonstrates that a small Qwen3-4B model with LoRA can be trained on structured, role-specific security-review examples and run locally in a staged Gradio interface. It can return useful findings and patch suggestions in some cases.

The current evaluation is not strong enough to use the system as a security gate. In particular:

- A no_finding result is not proof that code is safe.
- The 12-case test is small and has already informed development after its outputs were examined.
- Token accuracy and validation loss are not measures of vulnerability detection quality.
- The app’s patch check only verifies diff-like shape; it does not prove a patch applies or fixes the issue.
- The application never modifies files, and all patch proposals require human review.

Use task-level metrics on a fresh, untouched, larger benchmark—such as per-role confusion matrices, false-positive and false-negative rates, JSON validity, patch correctness, and end-to-end outcome accuracy—before making effectiveness claims.
