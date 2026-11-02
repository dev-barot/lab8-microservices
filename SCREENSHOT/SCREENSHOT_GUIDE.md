# Lab 8 Screenshot & Deliverable Guide

This guide details each of the 13 required pieces of evidence for the Lab 8 submission, along with the exact commands and screens to capture.

| No. | File Name | Deliverable | What to Capture |
|---|---|---|---|
| **1** | `01-lab7-baseline.png` | Lab 7 baseline | Postman screenshot showing a successful request (`GET /health` or `GET /users`) and response through the gateway. |
| **2** | `02-k8s-environment.png` | Kubernetes environment | Terminal output showing `kubectl config current-context` and `kubectl get nodes` with at least one Ready node. |
| **3** | `03-manifests.png` | Manifests | VS Code / directory listing showing all YAML files in `k8s/` (`gateway-deployment.yaml`, `gateway-service.yaml`, `user-deployment.yaml`, `user-service.yaml`, `product-deployment.yaml`, `product-service.yaml`, `order-deployment.yaml`, `order-service.yaml`, `configmap.yaml`, `secret.yaml`, `monitoring/`). |
| **4** | `04-deployment-lab8.png` | Deployment in `lab8` | Terminal output of `kubectl get all -n lab8` showing Deployments, Pods, and Services in `Running` / `Ready` state. |
| **5** | `05-gateway-test.png` | Gateway test | Postman request through the Kubernetes API Gateway (`http://localhost:8080` or `http://localhost:30080`) returning a `200 OK` response with internal microservice data. |
| **6** | `06-scaling-user-service.png` | Scaling | Terminal showing `kubectl scale deployment user-service --replicas=3 -n lab8` followed by `kubectl get pods -n lab8` showing 3 running user-service pods. |
| **7** | `07-self-healing.png` | Self-healing | Terminal showing `kubectl delete pod <user-service-pod-name> -n lab8` followed immediately by `kubectl get pods -n lab8` showing a newly spawned replacement pod terminating/running. |
| **8** | `08-troubleshooting.png` | Troubleshooting | Terminal showing `kubectl describe pod <pod-name> -n lab8`, `kubectl logs <pod-name> -n lab8`, and `kubectl get endpoints -n lab8`. |
| **9** | `09-github-actions-ci.png` | GitHub Actions | Web browser screenshot of the GitHub repository's **Actions** tab showing a successful green run of the CI workflow. |
| **10** | `10-prometheus-targets-query.png` | Prometheus Targets & Query | Web browser screenshot of Prometheus UI: Targets page showing `gateway` in `UP` state, and Graph page running `up` or `rate(http_requests_total[5m])`. |
| **11** | `11-grafana-dashboard.png` | Grafana Dashboard | Web browser screenshot of the Grafana dashboard showing panels for Gateway Availability, Request Rate, Status Codes, and Latency. |
| **12** | `12-traffic-observation.png` | Traffic Observation | Prometheus or Grafana graph displaying a visible spike/activity after firing traffic from Postman. |
| **13** | `13-architecture-diagram.png` | Architecture Diagram | Final architecture diagram showing Postman -> Kubernetes Gateway -> ClusterIP Services -> Pods + Atlas & Prometheus/Grafana. |

