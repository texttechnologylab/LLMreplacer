# DUUI Log Converter

A zero-setup browser tool that converts [DockerUnifiedUIMAInterface](https://github.com/texttechnologylab/DockerUnifiedUIMAInterface) (DUUI)
Python tool components to use the [`duui_logging`](https://github.com/texttechnologylab/DUUIlogger)
library. Two methods: an offline rule-based **Algorithm**, or an **LLM** via a self-hosted
[OpenWebUI](https://openwebui.com/). For the LLM, a capable model like **`gpt-oss:20b`** is
recommended; small models (e.g. llama3.2) are less reliable.

## Quickstart

1. **Download this repo** (green *Code -> Download ZIP*, or `git clone`) and unzip it.
2. **Open `index.html`** in your browser (double-click it).
3. **Pick a method.** For **Algorithm (offline)** you are ready to go. For **LLM (OpenWebUI)**
   the base URL is prefilled (`https://llm.texttechnologylab.org/`); paste your **API key**,
   click **Load models**, and pick a model.
4. **Drop your files:** drag `.py` files (or a whole project folder) onto the drop zone.
   `pyproject.toml` and `requirements.txt` are picked up too and get the `duui-logging`
   dependency added (git source for `pyproject.toml` and `duui-logging @ git+...` line for
   `requirements.txt`).
5. **Convert & download:** click **Convert all**, review (and edit) each diff, then **Download (all (.zip))**.
