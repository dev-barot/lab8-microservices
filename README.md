# Lab 8: Kubernetes Orchestration, CI/CD with GitHub Actions & Monitoring

**Course:** Web Services & SOA Laboratory  
**Topic:** Kubernetes • GitHub Actions • Prometheus • Grafana  
**Author:** Dev Barot (202512069)  
**Base Repository:** Lab 7 API Gateway + User / Product / Order Microservices + MongoDB Atlas  

---

## 1. Executive Summary & Application Overview

This lab transitions the containerized microservices application developed in **Lab 7** into an automated, production-grade DevOps environment:
1. **Kubernetes Orchestration:** Deploying the API Gateway, User Service, Product Service, and Order Service as declarative Kubernetes Deployments and Services within a dedicated `lab8` namespace.
2. **Resilience & Health Checks:** Implementing Kubernetes Liveness and Readiness probes against dedicated application `/health` endpoints.
3. **Scaling & Self-Healing:** Demonstrating horizontal pod scaling and automatic container self-healing under failure conditions.
4. **CI/CD Automation:** Designing a GitHub Actions workflow (`.github/workflows/ci.yml`) that validates syntax/tests, builds versioned Docker images tagged by Git commit SHA (`${{ github.sha }}`), and prepares them for container registry delivery.
5. **Full-Stack Monitoring:** Exposing standard Prometheus metrics (`/metrics`) on the API Gateway, scraping targets via Prometheus, querying metrics with PromQL (`up`, `rate(http_requests_total[5m])`), and visualizing live application traffic in Grafana.

---

## 2. System Architecture & Topology

### End-to-End Architectural Flow
```
Client / Postman
      │
      ▼ (HTTP NodePort :30080 or Port-Forward :8080)
┌─────────────────────────────────────────────────────────────┐
│  Kubernetes Cluster (Namespace: lab8)                       │
│                                                             │
│   ┌──────────────────────────┐                              │
│   │  gateway-service (Svc)   │                              │
│   └─────────────┬────────────┘                              │
│                 ▼                                           │
│   ┌──────────────────────────┐                              │
│   │ gateway-service (Pods)   │                              │
│   │ [/health, /metrics]      │                              │
│   └──┬──────────┬──────────┬─┘                              │
│      │          │          │                                │
│      ▼          ▼          ▼                                │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐                        │
│  │ User    │ │ Product │ │ Order   │                        │
│  │ Service │ │ Service │ │ Service │                        │
│  │ (:3001) │ │ (:3002) │ │ (:3003) │                        │
│  └────┬────┘ └────┬────┘ └────┬────┘                        │
│       │           │           │                             │
│       │           └─────┬─────┘                             │
│       ▼                 ▼                                   │
│  ┌─────────────────────────┐                                │
│  │ External Database Layer │                                │
│  │ (MongoDB Atlas / Svc)   │                                │
│  └─────────────────────────┘                                │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Monitoring Subsystem                                 │   │
│  │                                                      │   │
│  │  Prometheus (:9090) ──Scrapes──> Gateway (:8080)     │   │
│  │         │                                            │   │
│  │         ▼                                            │   │
│  │   Grafana (:3000) ──Visualizes Metrics & Dashboards │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Architectural Layer Responsibilities
| Component | Kubernetes Resource Type | Internal Cluster DNS | External Exposure |
|---|---|---|---|
| **API Gateway** | `Deployment` (1 replica) + `Service` | `http://gateway-service:8080` | `NodePort 30080` or `Port-Forward 8080` |
| **User Service** | `Deployment` (1-3 replicas) + `Service` | `http://user-service:3001` | Cluster-Internal only (`ClusterIP`) |
| **Product Service**| `Deployment` (1 replica) + `Service` | `http://product-service:3002` | Cluster-Internal only (`ClusterIP`) |
| **Order Service** | `Deployment` (1 replica) + `Service` | `http://order-service:3003` | Cluster-Internal only (`ClusterIP`) |
| **Prometheus** | `Deployment` + `ConfigMap` + `Service` | `http://prometheus-service:9090` | `NodePort 30090` or `Port-Forward 9090` |
| **Grafana** | `Deployment` + `Service` | `http://grafana-service:3000` | `NodePort 30300` or `Port-Forward 3000` |
| **MongoDB Atlas**| External Managed Cloud DB | Secure Atlas SRV URI | Private TLS Auth / Cluster Secret |

---

## 3. Kubernetes Environment & Prerequisites

### Prerequisites
- **Docker Desktop** (or Minikube / Kind / K3s) with Kubernetes enabled.
- **kubectl CLI** configured and connected to the active cluster.
- **Node.js 22** & **npm** installed locally.
- **Postman** for HTTP testing and traffic generation.
- **GitHub Repository** for CI/CD workflow execution.

### Verification of Kubernetes Environment
```powershell
# 1. Verify active context
kubectl config current-context

# 2. Check node availability
kubectl get nodes

# 3. Create and verify the Lab 8 namespace
kubectl create namespace lab8
kubectl get namespaces
```

---

## 4. Manifest Structure & Configuration (`k8s/`)

All Kubernetes manifests are organized cleanly under the `k8s/` directory:

```
k8s/
├── configmap.yaml                # Non-sensitive configuration (Service URLs & ports)
├── secret.yaml                   # Sensitive database connection URIs
├── gateway-deployment.yaml       # API Gateway Pod Deployment & Probes
├── gateway-service.yaml          # NodePort Service exposing Gateway on 30080/8080
├── user-deployment.yaml          # User Service Deployment & Probes
├── user-service.yaml             # User Service ClusterIP Service (:3001)
├── product-deployment.yaml       # Product Service Deployment & Probes
├── product-service.yaml          # Product Service ClusterIP Service (:3002)
├── order-deployment.yaml         # Order Service Deployment & Probes
├── order-service.yaml            # Order Service ClusterIP Service (:3003)
├── mongodb.yaml                  # (Optional) In-cluster MongoDB fallback deployment
└── monitoring/
    ├── prometheus-configmap.yaml # Scrape configurations targeting gateway-service
    ├── prometheus-deployment.yaml# Prometheus Server Pod Deployment
    ├── prometheus-service.yaml   # Prometheus NodePort Service (:30090)
    ├── grafana-datasource-configmap.yaml # Auto-provisioned Prometheus datasource
    ├── grafana-deployment.yaml   # Grafana Dashboard Server Deployment
    └── grafana-service.yaml      # Grafana NodePort Service (:30300)
```

### 4.1 Non-Sensitive Configuration (`ConfigMap`)
Non-sensitive service discovery URLs and default ports are managed through `app-config`:
- `USER_SERVICE_URL: http://user-service:3001`
- `PRODUCT_SERVICE_URL: http://product-service:3002`
- `ORDER_SERVICE_URL: http://order-service:3003`

### 4.2 Sensitive Credentials (`Secret`)
Database credentials are strictly decoupled from container images using the `app-secrets` Secret:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: app-secrets
  namespace: lab8
type: Opaque
stringData:
  MONGO_URI_USER: "mongodb+srv://<user>:<password>@cluster0.mongodb.net/user_db"
  MONGO_URI_PRODUCT: "mongodb+srv://<user>:<password>@cluster0.mongodb.net/product_db"
  MONGO_URI_ORDER: "mongodb+srv://<user>:<password>@cluster0.mongodb.net/order_db"
```
*(No passwords or production tokens are committed to source control).*

### 4.3 Health & Readiness Probes
All microservice Deployments implement both `livenessProbe` and `readinessProbe` targeting `/health`:
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 10
readinessProbe:
  httpGet:
    path: /health
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
```
- **Liveness:** Verifies whether the process is healthy; restarts the container if unresponsive.
- **Readiness:** Ensures the Pod does not receive gateway traffic until it has successfully initialized.

---

## 5. Deployment & Step-by-Step Verification

### 5.1 Building Docker Images Locally
```powershell
docker build -t devbarot/api-gateway:latest ./api-gateway
docker build -t devbarot/user-service:latest ./user-service
docker build -t devbarot/product-service:latest ./product-service
docker build -t devbarot/order-service:latest ./order-service
```

### 5.2 Deploying Application to Kubernetes
```powershell
# 1. Apply config and secrets
kubectl apply -f k8s/configmap.yaml -n lab8
kubectl apply -f k8s/secret.yaml -n lab8

# 2. Deploy microservices & gateway
kubectl apply -f k8s/ -n lab8

# 3. Check status of all resources in lab8
kubectl get all -n lab8
```

### 5.3 Exposing & Testing the Gateway
The gateway is reachable externally via NodePort `30080` or port-forwarding:
```powershell
# Port forward (recommended for local testing on port 8080):
kubectl port-forward svc/gateway-service 8080:8080 -n lab8
```

Test requests via Postman or curl:
```powershell
# Health Check
curl http://localhost:8080/health

# Prometheus Metrics
curl http://localhost:8080/metrics

# Fetch Users
curl http://localhost:8080/users

# Create User
curl -X POST http://localhost:8080/users -H "Content-Type: application/json" -d '{"name":"Dev Barot","email":"dev@example.com","role":"student"}'
```

---

## 6. Scaling & Self-Healing Demonstrations

### 6.1 Horizontal Scaling
Scale the `user-service` from 1 replica to 3 replicas:
```powershell
kubectl scale deployment user-service --replicas=3 -n lab8
kubectl get pods -n lab8 -l app=user-service
```
**Observation:** Kubernetes rapidly provisions 2 additional pods. The `user-service` ClusterIP service distributes requests transparently across all 3 ready replicas without any downtime.

### 6.2 Self-Healing Verification
Identify an active pod and delete it:
```powershell
# Get active pods
kubectl get pods -n lab8 -l app=user-service

# Delete one pod
kubectl delete pod <user-service-pod-name> -n lab8

# Observe self-healing
kubectl get pods -n lab8 -l app=user-service
```
**Observation:** The Kubernetes ReplicaSet immediately detects that the actual replica count (2) is less than the desired count (3) and automatically spawns a replacement pod to restore the desired state.

---

## 7. Part B — GitHub Actions CI/CD Pipeline

The CI/CD pipeline defined in `.github/workflows/ci.yml` triggers on every push and pull request to `main`:

### Workflow Stages:
1. **Lint & Test (`lint-and-test`):**
   - Checks out repository code.
   - Sets up Node.js 22 runtime.
   - Installs dependencies and runs syntax/unit tests across all four microservice directories.
2. **Build & Package (`build-and-push`):**
   - Initializes Docker Buildx.
   - Builds versioned Docker images tagged with both `${{ github.sha }}` and `latest`.
   - Optionally logs in to Docker Hub and delivers the versioned images when repository secrets (`DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`) are configured.
   - Outputs verification summary.

```yaml
# Versioning Approach
docker build -t devbarot/user-service:${GITHUB_SHA} ./user-service
docker push devbarot/user-service:${GITHUB_SHA}
```

### Rolling Update to New Version:
To roll out a newly built CI version to Kubernetes:
```powershell
kubectl set image deployment/user-service user-service=devbarot/user-service:<COMMIT_SHA> -n lab8
kubectl rollout status deployment/user-service -n lab8
```

---

## 8. Part C — Monitoring with Prometheus & Grafana

### 8.1 Deploying the Monitoring Stack
```powershell
kubectl apply -f k8s/monitoring/ -n lab8
kubectl get pods,svc -n lab8 -l app=prometheus
kubectl get pods,svc -n lab8 -l app=grafana
```

Accessing the dashboards:
```powershell
# Port-forward Prometheus (9090)
kubectl port-forward svc/prometheus-service 9090:9090 -n lab8

# Port-forward Grafana (3000)
kubectl port-forward svc/grafana-service 3000:3000 -n lab8
```

### 8.2 Prometheus Metrics & Queries
Open `http://localhost:9090` in your browser:
- **Targets Page (`Status -> Targets`):** The `gateway` scrape target (`gateway-service:8080/metrics`) reports **UP**.
- **Useful PromQL Queries:**
  - `up`: Checks if the target is healthy and responding (returns `1`).
  - `rate(http_requests_total[1m])`: Real-time request rate per second.
  - `sum by (status_code) (http_requests_total)`: Total requests grouped by HTTP status code.
  - `http_request_duration_seconds_bucket`: Request latency distribution.

### 8.3 Grafana Visualization
1. Open `http://localhost:3000` (Login: `admin` / `admin`).
2. The Prometheus datasource is auto-provisioned.
3. Create a **Lab 8 Monitoring Dashboard** with 4 essential panels:
   - **Panel 1: Gateway Availability** (`up{job="gateway"}`) — Stat / Gauge panel.
   - **Panel 2: Incoming Request Rate** (`sum(rate(http_requests_total[1m]))`) — Time series chart.
   - **Panel 3: HTTP Status Code Breakdown** (`sum by (status_code) (http_requests_total)`) — Bar / Pie chart.
   - **Panel 4: Latency / Duration** (`histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))`) — Time series gauge.

### 8.4 Generating Traffic
Send multiple requests from Postman or run a PowerShell traffic loop:
```powershell
1..30 | ForEach-Object {
    Invoke-RestMethod -Uri "http://localhost:8080/health"
    Invoke-RestMethod -Uri "http://localhost:8080/users" -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 200
}
```
Observe the live spike in Prometheus and Grafana dashboards!

---

## 9. Troubleshooting & Inspection Commands

| Diagnostic Task | Kubernetes Inspection Command |
|---|---|
| Pod Failures / CrashLoopBackOff | `kubectl describe pod <pod-name> -n lab8` |
| Application Logs | `kubectl logs <pod-name> -n lab8` |
| Follow Streaming Logs | `kubectl logs -f <pod-name> -n lab8` |
| Service Endpoint Discovery | `kubectl get endpoints -n lab8` |
| ConfigMap / Secret Inspection | `kubectl describe configmap app-config -n lab8` |
| Rollback Deployment | `kubectl rollout undo deployment/<service-name> -n lab8` |

---

## 10. Submission Checklist & Evidence References

| Requirement / Checklist Item | Verification Command / Deliverable | Status |
|---|---|---|
| ☐ Lab 7 application verified | Postman test on baseline Lab 7 gateway | `SCREENSHOT/01-lab7-baseline.png` |
| ☐ Kubernetes context/node verified | `kubectl config current-context` & `get nodes` | `SCREENSHOT/02-k8s-environment.png` |
| ☐ Manifests created in `k8s/` | Directory & YAML inspection | `SCREENSHOT/03-manifests.png` |
| ☐ `lab8` namespace created & deployed | `kubectl get all -n lab8` | `SCREENSHOT/04-deployment-lab8.png` |
| ☐ Gateway tested from Postman | `GET /health`, `GET /users` via K8s Gateway | `SCREENSHOT/05-gateway-test.png` |
| ☐ User Service scaled to 3 replicas | `kubectl scale deployment user-service --replicas=3` | `SCREENSHOT/06-scaling-user-service.png` |
| ☐ Self-healing demonstrated | `kubectl delete pod` & immediate recovery | `SCREENSHOT/07-self-healing.png` |
| ☐ Troubleshooting output captured | `describe`, `logs`, and `get endpoints` | `SCREENSHOT/08-troubleshooting.png` |
| ☐ GitHub Actions CI/CD passed | Green CI pipeline run on GitHub | `SCREENSHOT/09-github-actions-ci.png` |
| ☐ Prometheus targets/metrics verified | Targets `UP` & PromQL query executed | `SCREENSHOT/10-prometheus-targets-query.png` |
| ☐ Grafana dashboard created | 4-panel dashboard in Grafana UI | `SCREENSHOT/11-grafana-dashboard.png` |
| ☐ API traffic generated and observed | Spiking graphs after Postman requests | `SCREENSHOT/12-traffic-observation.png` |
| ☐ Architecture diagram complete | System topology & monitoring flow | `SCREENSHOT/13-architecture-diagram.png` |

---

## 11. Exercise 9 — Prometheus Scrape and Query (Lab 8)

### 11.1 Minimal Scrape Target (`prometheus.yml` / `k8s/monitoring/prometheus-configmap.yaml`)
To scrape metrics from `gateway-service:8080` where metrics are exposed at `/metrics`:
```yaml
scrape_configs:
  - job_name: "gateway"
    metrics_path: /metrics
    static_configs:
      - targets: ["gateway-service:8080"]
```

### 11.2 Target Availability Query
```promql
up{job="gateway"}
```
- **Evaluation:** Evaluates to `1` when the target is reachable and healthy (UP), or `0` if the target is down/unreachable.

### 11.3 Two Useful Application Metrics & Postman Traffic Role
1. **`http_requests_total`** (Counter): Measures total incoming HTTP requests partitioned by `method`, `route`, and `status_code`. Enables calculating real-time request rates via `rate(http_requests_total[1m])`.
2. **`http_request_duration_seconds`** (Histogram): Tracks request latency and duration distributions across routes.

#### How Postman Traffic Helps:
- **Populating Real Data:** Without traffic, counters remain stationary and rate calculations evaluate to zero. Sending Postman requests triggers active increments, measures real request durations, and generates diverse HTTP status codes (`200 OK`, `201 Created`, `404 Not Found`).
- **Verifying Observability Pipelines:** Dynamic traffic creates observable spikes in Prometheus queries and Grafana panels, validating that the monitoring stack accurately captures live system behavior.

