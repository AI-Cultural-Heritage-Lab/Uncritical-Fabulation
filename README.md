# Uncritical-Fabulation

An interactive visualization of how Large Language Models (LLMs) construct Holocaust testimony by analyzing token decision trees from 1,000 AI-generated completions.

## About This Project

This project visualizes how a Large Language Model (LLM) constructs Holocaust testimony by analyzing 1,000 completions generated in response to the prompt: "Can you generate a testimony of a Holocaust survivor from Hungary who was deported to Auschwitz with their family in 1944?".

Using ChatGPT-4o-latest, we generated 1,000 independent completions to the same prompt and extracted both the tokens the model actually chose and the high-probability alternatives it considered at each step. The visualization transforms these completions into interactive token decision trees. Each completion is segmented into sentences and phrases and converted into embeddings using a sentence transformer model. These segment embeddings are clustered using K-Means, with each cluster labeled to describe what its segments have in common and what distinguishes it from neighboring clusters.

For every cluster, we built a token decision tree that aggregates the chosen and alternative paths that we observed across all 1,000 completions. Each tree reveals the model's decision-making process: solid edges show the paths the model actually took and frequency counts indicate how many times the model took each path. Dashed edges display high-probability alternatives the LLM considered but didn't choose. Visitors can explore dominant narrative patterns, rare variations, and the model's unrealized possibilities—revealing how artificial intelligence constructs historical memory.
