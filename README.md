---
title: OpenClaw Telethon
emoji: 🦞
sdk: docker
app_port: 7860
startup_duration_timeout: 45m
---

# Set up your own OpenClaw with Telethon

Use your **own Telegram bot token, API ID, API hash, AI account, and private backup storage**. This repository contains the deployment files for the tested OpenClaw Telethon fork, including the fixes for deleted-message placeholders and inaccessible private-channel metadata.

OpenClaw and its web interface still run in Node.js. The Telegram transport and update conversion run in Python with Telethon. Mini Apps and web components keep their existing implementation; their individual URLs and Telegram configuration still need to be set up for your bot.

**Fresh-install behavior:** anyone can DM the bot, and all groups/channels where it has Telegram access are allowed. Group replies require an `@YourBotUsername` mention. Anyone allowed through Telegram can use the configured agent; keep your gateway secret private. You can restrict access later, and saved policies survive restarts.

## Files to copy

Put these five files together at the root of your Hugging Face Space or local Docker build directory:

| File | Purpose |
| --- | --- |
| [README.md](README.md) | This guide and Hugging Face Docker/port metadata |
| [Dockerfile](Dockerfile) | Installs the pinned OpenClaw fork and Telethon, checks the Python tests, and builds the full runtime |
| [start-telegram.mjs](start-telegram.mjs) | Starts the web proxy and bot, preserves saved settings, and restarts an unresponsive gateway |
| [space-state.mjs](space-state.mjs) | Creates verified private checkpoints and restores them on a fresh container |
| [space-state.test.mjs](space-state.test.mjs) | Eight focused backup/recovery tests |

[.env.example](.env.example) is a placeholder reference for local Docker. Do not put real credentials in this README, the Dockerfile, or GitHub.

## 1. Get your own Telegram credentials

1. Open the official [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot`, choose a name and username, and save the bot token privately.
3. Log in at [my.telegram.org](https://my.telegram.org), open **API development tools**, and create your own Telegram application.
4. Save its numeric `api_id` and `api_hash` privately. These are separate from the bot token. See [Telegram's application setup instructions](https://core.telegram.org/api/obtaining_api_id).

You do **not** need a premade bot session file. On first startup, Telethon signs in with your bot token and application credentials and creates its own session. Do not copy another person's session or backup: those contain credentials and private state.

Run one deployment for each bot token while setting this up. Stop an older instance of the same bot before starting its replacement.

## 2. Create a gateway secret

Generate a long random value on your own computer:

```sh
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Save this as `OPENCLAW_GATEWAY_TOKEN`. It is the password for the OpenClaw web interface, **not** your Telegram bot token. This deployment automatically approves device-pairing requests authenticated with that secret, so anyone holding it can manage your instance.

## 3. Deploy on Hugging Face

### Create a Docker Space

1. Sign in to your own [Hugging Face account](https://huggingface.co).
2. Create a Space and choose **Docker** with a blank template.
3. Use CPU hardware with at least 16 GB RAM; CPU Basic is the hardware used by the existing deployment.
4. Choose public or private visibility for the web interface. This does not change Telegram's separate sender-access policy.

**Account eligibility:** Hugging Face's current documentation requires an eligible paid plan to create Docker Spaces. Check your account's available options and prices; do not assume a new Space will be free. If that is unsuitable, use [local Docker](#local-docker-or-a-docker-vps) below. See [Spaces creation requirements](https://huggingface.co/docs/hub/spaces-overview#creating-a-new-space).

### Add private secrets before uploading the app

In your Space, open **Settings → Variables and secrets → New secret**. Add these exact names:

| Secret name | Your value |
| --- | --- |
| `TELEGRAM_API_ID` | Your numeric Telegram application ID |
| `TELEGRAM_API_HASH` | Your Telegram application hash |
| `TELEGRAM_BOT_TOKEN` | Your bot token from BotFather |
| `OPENCLAW_GATEWAY_TOKEN` | The random gateway secret you generated |

Use **secrets**, not public variables. An AI provider key is separate; configure your own provider in OpenClaw after startup.

### Attach private backup storage

1. Create a **private Hugging Face Storage Bucket** in your own account, for example `YOUR_USERNAME/openclaw-state`.
2. In your Space's settings, find **Storage Buckets → Mount a bucket → Mount existing bucket**.
3. Select your private bucket.
4. Set the mount path to exactly **`/data/openclaw-backups`**.
5. Select **Read & Write** and mount it. Leave optional paid CDN features off unless you want them.

The bucket must be private because checkpoints contain bot sessions, model credentials, and other OpenClaw state. Use a new bucket for your instance, and do not share one backup directory between different running instances.

Ordinary Space storage is ephemeral. The launcher deliberately refuses to start without the backup directory rather than silently losing settings. See [Hugging Face persistent volumes](https://huggingface.co/docs/hub/spaces-storage).

### Upload the files

1. Download this repository as a ZIP or clone it:

   ```sh
   git clone https://github.com/ArnavSingh76533/instructions.git
   ```

2. Upload the five files listed above into the **root** of your Space. Do not upload an enclosing `instructions-main/` folder.
3. Keep the YAML block at the top of `README.md`; it tells Hugging Face to use Docker and port 7860.
4. Wait for the image build and runtime startup to finish. Cold starts compile OpenClaw and can take several minutes; about 5–16 minutes was observed on the existing Space. The first image build can take longer. Do not repeatedly restart during compilation.
5. Read **Logs → Build** for dependency/test errors and **Logs → Container** for startup progress.

The current Dockerfile keeps the dependency layer pinned and overlays only the tested Telegram repair files, avoiding a full dependency reinstall for that repair.

## 4. Connect the web interface and AI model

1. Open your Space's app. If the embedded view has trouble, open the direct `https://YOUR_SPACE_SUBDOMAIN.hf.space` address shown for your Space.
2. When OpenClaw asks for its gateway secret, enter **your `OPENCLAW_GATEWAY_TOKEN`**. Never enter the Telegram bot token there.
3. Open **Settings → Models**, connect your own supported AI account/provider, choose a model, and run its verification/check action.
4. For Codex sign-in, complete the browser/device-code flow shown by OpenClaw using your own account.
5. Wait until the container log shows **`[space-state] Saved verified checkpoint ...`** after your setup changes.

Telegram credentials only connect the bot to Telegram. The bot still needs a working AI model to generate replies. Do not copy someone else's model login or API key.

## 5. Test your bot

1. Open **Settings → Channels → Telegram** and run **Check connection**. Confirm the username belongs to your bot and that the account is running.
2. Open your bot in Telegram, press **Start**, and send a short message. Confirm an AI reply arrives.
3. Add your bot to a test group and send `@YourBotUsername hello`.
4. For channels, add the bot with the permissions needed for the intended action, including posting rights when it must publish replies. This configuration does not grant Telegram membership or administrator rights automatically.
5. After a successful checkpoint, restart the Space once. Confirm the model selection, login, and Telegram setup remain and that the bot can still reply.

Telegram's privacy mode affects which group messages reach a bot; OpenClaw cannot process messages Telegram does not deliver. Keep mentions for the default setup. If you intentionally want replies without mentions, review both the OpenClaw mention setting and BotFather's privacy setting. See [Telegram privacy mode](https://core.telegram.org/bots/features#privacy-mode).

## Change access later

The launcher supplies defaults only; existing Telegram policy values are preserved on restart.

- **Open DMs:** `channels.telegram.dmPolicy = "open"` and `channels.telegram.allowFrom = ["*"]`.
- **All groups/channels with Telegram access:** `channels.telegram.groupPolicy = "open"`, with a wildcard `groups["*"]` entry. The initial entry sets `requireMention: true`.
- **Restrict DMs:** use `dmPolicy = "allowlist"` and numeric sender IDs in `allowFrom`, or use the optional `TELEGRAM_ALLOW_FROM` environment setting.
- **Change group rules:** edit the relevant group entry in Settings. Specific per-group/per-topic overrides can take precedence over defaults.

Leave `TELEGRAM_ALLOW_FROM` unset for the same open-DM behavior as this template. If set, the launcher reapplies that environment allowlist on startup. Save and apply settings changes through OpenClaw, then wait for a successful checkpoint. Do not replace the whole configuration with a small example and accidentally remove your other settings.

## How persistence works

- Live files stay in `/home/node/.openclaw`, including the token-scoped Telethon session under `telegram/telethon/`.
- The launcher uses OpenClaw's native **backup create/verify/restore** commands for coherent state snapshots.
- Verified archives and completion metadata are written to `/data/openclaw-backups`. The latest three completed generations are retained.
- Checkpoints run periodically every two minutes, shortly after configuration changes, and on graceful shutdown.
- A fresh container restores the latest completed archive before loading its configuration. A gateway-process restart keeps the existing local state.
- A hard crash can lose changes since the last successful checkpoint. Wait for the saved-checkpoint log before a planned restart.

Do not place live SQLite databases directly on the object-storage bucket mount. Do not commit `.env`, session files, databases, or backup archives to GitHub.

## Local Docker or a Docker VPS

Use the same files if you already have Docker installed and enough RAM for the runtime build.

1. Copy `.env.example` to `.env` and replace every placeholder. On Windows PowerShell use `Copy-Item .env.example .env`; on Linux/macOS use `cp .env.example .env`.
2. Build the image:

   ```sh
   docker build -t openclaw-telethon .
   ```

3. Create a private local backup volume and make it writable by the application's UID 1000:

   ```sh
   docker volume create openclaw-backups
   docker run --rm --user 0 --mount type=volume,source=openclaw-backups,target=/backups node:24-bookworm-slim chown 1000:1000 /backups
   ```

4. Start the app:

   ```sh
   docker run -d --name openclaw-telethon --env-file .env -p 127.0.0.1:7860:7860 --mount type=volume,source=openclaw-backups,target=/data/openclaw-backups openclaw-telethon
   docker logs -f openclaw-telethon
   ```

5. Open `http://localhost:7860` on the Docker host, then follow the model and Telegram testing steps above. For a remote VPS, use an SSH tunnel such as `ssh -L 7860:127.0.0.1:7860 YOUR_USER@YOUR_SERVER` and open that localhost address on your own computer. The example binds the web interface to loopback.

The named volume survives container removal. Keep it private and back it up separately; do not delete it when recreating the container. Use a different volume for each independent instance. A fresh container compiles the runtime again before serving the interface.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Connecting / gateway starting | Check container build progress first; cold starts compile the full application. Then check `/healthz` and `/readyz` on the app URL. |
| Gateway secret rejected | Enter `OPENCLAW_GATEWAY_TOKEN`, not the Telegram bot token. |
| Backup directory missing / ephemeral-only startup refused | Mount your own private bucket read-write at `/data/openclaw-backups`, or attach the local Docker volume. |
| Bot connects but does not answer | Verify the AI model can produce a reply; check group mentions and Telegram permissions. |
| Session lock or polling conflict | Stop other deployments using that same bot token/session. Keep one active runtime. |
| Telethon worker not ready / conversion errors | Check channel and container logs. This bundle includes the deleted-message and private-channel metadata fixes; verify the pinned repair ref below. Do not delete queued receipts or the session as a first step. |
| Model disappears on restart | Confirm a successful checkpoint exists in your private bucket and that startup restores it; inspect checkpoint failure logs. |
| Docker Space creation unavailable | Check current Hugging Face account requirements or use local Docker. |

## Version and checks

- OpenClaw base: [`f0b4a9f7ce9e869f43998d75e5fc8cb7856ccb24`](https://github.com/ArnavSingh76533/openclaw-for-telethon/commit/f0b4a9f7ce9e869f43998d75e5fc8cb7856ccb24).
- Telegram repair overlay: [`4fd651f5c82b98c06edd82f81655deb692a72376`](https://github.com/ArnavSingh76533/openclaw-for-telethon/commit/4fd651f5c82b98c06edd82f81655deb692a72376).
- The Dockerfile runs **77 Python tests** against the repaired Telegram source and **8 backup/recovery tests**.
- You can run the backup/recovery tests independently with Node 24: `node --test space-state.test.mjs`.
- The source deployment was checked with real Telegram incoming/outgoing activity and a restart. This copyable template still needs testing with **your own** credentials and deployment.

Changing the pinned source versions is an upgrade: check compatibility and rerun the tests before replacing them.
