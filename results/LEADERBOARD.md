# Leaderboard

UnsafeBench (yiting/UnsafeBench), train 8,109 + test 2,037. Same prompt for every model; threshold = best F1 on train, headline metrics on test. 95% bootstrap intervals in brackets.

## Accuracy (test split, 2,037 images)

| Model | AUROC | AP | F1 | Precision | Recall | FPR | Recall @5% FPR | Recall @10% FPR | Own-verdict F1 | Category acc. |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cloudflare clef-flash | 0.856 [0.839, 0.872] | 0.802 | 0.715 [0.690, 0.738] | 62.5% | 83.7% | 31.0% | 46.5% | 61.3% | 0.615 | 54.2% |
| TypeSafe Jev 1.14 | 0.866 [0.848, 0.882] | 0.813 | 0.721 [0.696, 0.745] | 65.5% | 80.1% | 26.0% | 50.7% | 62.0% | 0.710 | 55.7% |
| Claude Haiku 5.5 | 0.859 [0.841, 0.875] | 0.774 | 0.736 [0.714, 0.759] | 65.6% | 83.9% | 27.1% | 31.4% | 54.6% | 0.691 | 49.7% |
| Amazon Rekognition | 0.698 [0.674, 0.722] | 0.621 | 0.569 [0.545, 0.591] | 40.7% | 94.9% | 85.4% | 30.2% | 41.2% | 0.443 | n/a |

## Speed and cost (all 10,146 images)

| Model | Provider | Latency p50 | p90 | p95 | p99 | Full job (wall) | Images/s | Concurrency | Cost / 1k images | Total cost | Tokens in / out per image |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cloudflare clef-flash | Cloudflare Workers AI | 471 ms | 874 ms | 1010 ms | 1445 ms | 11.9 min | 14.27 | 8 | $0.040 | $0.40 | 1046 / 0 |
| TypeSafe Jev 1.14 | OpenRouter (Decisions API) | 162 ms | 258 ms | 313 ms | 562 ms | 4.0 min | 42.24 | 8 | $0.077 | $0.78 | 1823 / 141 |
| Claude Haiku 5.5 | Anthropic API | 1234 ms | 1795 ms | 2021 ms | 8126 ms | 29.1 min | 5.8 | 8 | $0.182 | $1.85 | 1666 / 32 |
| Amazon Rekognition | AWS (DetectModerationLabels) | 148 ms | 252 ms | 299 ms | 432 ms | 3.7 min | 45.69 | 8 | $1.000 | $10.15 | 0 / 0 |

## F1 by category (test split, at each model's train threshold)

| Model | hate | harassment | violence | self_harm | sexual | shocking | illegal_activity | deception | political | public_and_personal_health | spam |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cloudflare clef-flash | 0.361 | 0.537 | 0.728 | 0.532 | 0.857 | 0.794 | 0.812 | 0.585 | 0.778 | 0.632 | 0.718 |
| TypeSafe Jev 1.14 | 0.316 | 0.653 | 0.734 | 0.530 | 0.898 | 0.707 | 0.804 | 0.690 | 0.806 | 0.645 | 0.489 |
| Claude Haiku 5.5 | 0.444 | 0.602 | 0.735 | 0.519 | 0.878 | 0.752 | 0.814 | 0.737 | 0.819 | 0.647 | 0.579 |
| Amazon Rekognition | 0.267 | 0.378 | 0.617 | 0.262 | 0.830 | 0.689 | 0.638 | 0.503 | 0.710 | 0.565 | 0.508 |

## Real vs AI-generated images (test split)

| Model | LAION (real) AUROC | LAION F1 | Lexica (AI) AUROC | Lexica F1 |
| --- | --- | --- | --- | --- |
| Cloudflare clef-flash | 0.867 | 0.710 | 0.843 | 0.720 |
| TypeSafe Jev 1.14 | 0.881 | 0.732 | 0.848 | 0.711 |
| Claude Haiku 5.5 | 0.880 | 0.740 | 0.835 | 0.733 |
| Amazon Rekognition | 0.679 | 0.534 | 0.710 | 0.602 |
