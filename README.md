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

# Cite
If you want to use the project please quote this as follows:

Alexander Leonhardt, Giuseppe Abrami, Daniel Baumartz and Alexander Mehler. (2023). "Unlocking the Heterogeneous Landscape of Big Data NLP with DUUI." Findings of the Association for Computational Linguistics: EMNLP 2023, 385–399. [[LINK](https://aclanthology.org/2023.findings-emnlp.29)] [[PDF](https://aclanthology.org/2023.findings-emnlp.29.pdf)]

Daniel Bundan, Giuseppe Abrami (2026). "LLMreplacer". [[LINK](https://github.com/texttechnologylab/LLMreplacer)]

## BibTeX
```
@inproceedings{Leonhardt:et:al:2023,
  title     = {Unlocking the Heterogeneous Landscape of Big Data {NLP} with {DUUI}},
  author    = {Leonhardt, Alexander and Abrami, Giuseppe and Baumartz, Daniel and Mehler, Alexander},
  editor    = {Bouamor, Houda and Pino, Juan and Bali, Kalika},
  booktitle = {Findings of the Association for Computational Linguistics: EMNLP 2023},
  year      = {2023},
  address   = {Singapore},
  publisher = {Association for Computational Linguistics},
  url       = {https://aclanthology.org/2023.findings-emnlp.29},
  pages     = {385--399},
  pdf       = {https://aclanthology.org/2023.findings-emnlp.29.pdf},
  abstract  = {Automatic analysis of large corpora is a complex task, especially
               in terms of time efficiency. This complexity is increased by the
               fact that flexible, extensible text analysis requires the continuous
               integration of ever new tools. Since there are no adequate frameworks
               for these purposes in the field of NLP, and especially in the
               context of UIMA, that are not outdated or unusable for security
               reasons, we present a new approach to address the latter task:
               Docker Unified UIMA Interface (DUUI), a scalable, flexible, lightweight,
               and feature-rich framework for automatic distributed analysis
               of text corpora that leverages Big Data experience and virtualization
               with Docker. We evaluate DUUI{'}s communication approach against
               a state-of-the-art approach and demonstrate its outstanding behavior
               in terms of time efficiency, enabling the analysis of big text
               data.}
}

@misc{Bundan:Abrami:2026,
  title     = {LLMreplacer},
  author    = {Bundan, Daniel and Abrami, Giuseppe},
  year      = {2026},
  month     = {Sep},
  url       = {https://github.com/texttechnologylab/LLMreplacer}
}
```
