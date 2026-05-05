#!/usr/bin/env python3
from datetime import datetime, timezone
import os
import time

import docker
from flask import Flask, Response, jsonify
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, generate_latest
from prometheus_client.core import GaugeMetricFamily

app = Flask(__name__)
client = docker.from_env()
HOSTNAME = os.environ.get("COLLECTOR_HOSTNAME", "prd-eaw01")
CACHE_TTL = int(os.environ.get("CACHE_TTL_SECONDS", "10"))
_cache = {"expires_at": 0.0, "payload": None}
_metrics_cache = {"expires_at": 0.0, "containers": None}

def iso_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def normalize_health(container):
    state = container.attrs.get("State", {})
    health = state.get("Health")
    if health:
        return health.get("Status", "unknown")
    return "unknown"

def normalize_service(container):
    labels = container.labels or {}
    return labels.get("com.docker.compose.service") or labels.get("io.portainer.service") or container.name

def collect_containers():
    containers = []
    for container in client.containers.list(all=True):
        state = container.attrs.get("State", {})
        containers.append({
            "name": container.name,
            "service": normalize_service(container),
            "state": state.get("Status", container.status),
            "health": normalize_health(container),
            "image": container.image.tags[0] if container.image.tags else container.image.short_id,
            "started_at": state.get("StartedAt", ""),
        })
    containers.sort(key=lambda item: item["name"])
    return containers

def collect_container_metrics():
    containers = []
    for container in client.containers.list(all=True):
        state = container.attrs.get("State", {})
        containers.append({
            "name": container.name,
            "service": normalize_service(container),
            "state": state.get("Status", container.status),
            "health": normalize_health(container),
            "image": container.image.tags[0] if container.image.tags else container.image.short_id,
        })
    containers.sort(key=lambda entry: entry["name"])
    return containers

def get_cached_payload():
    now = time.time()
    if _cache["payload"] and now < _cache["expires_at"]:
        return _cache["payload"]
    containers = collect_containers()
    payload = {"host": HOSTNAME, "generated_at": iso_now(), "online": True, "containers": containers}
    _cache["payload"] = payload
    _cache["expires_at"] = now + CACHE_TTL
    return payload

def get_cached_metrics():
    now = time.time()
    if _metrics_cache["containers"] and now < _metrics_cache["expires_at"]:
        return _metrics_cache["containers"]
    containers = collect_container_metrics()
    _metrics_cache["containers"] = containers
    _metrics_cache["expires_at"] = now + CACHE_TTL
    return containers

@app.route("/health")
def health():
    return jsonify({"ok": True})

@app.route("/containers")
def containers():
    try:
        return jsonify(get_cached_payload())
    except Exception as exc:
        return jsonify({"host": HOSTNAME, "generated_at": iso_now(), "online": False, "error": str(exc), "containers": []}), 503

@app.route("/summary")
def summary():
    try:
        payload = get_cached_payload()
        containers = payload["containers"]
        unhealthy = sum(1 for item in containers if item["health"] == "unhealthy")
        degraded = sum(1 for item in containers if item["health"] not in ("healthy", "unknown") and item["state"] == "running")
        running = sum(1 for item in containers if item["state"] == "running")
        return jsonify({"host": payload["host"], "generated_at": payload["generated_at"], "online": payload["online"], "total": len(containers), "running": running, "stopped": len(containers) - running, "unhealthy": unhealthy, "degraded": degraded})
    except Exception as exc:
        return jsonify({"host": HOSTNAME, "generated_at": iso_now(), "online": False, "error": str(exc), "total": 0, "running": 0, "stopped": 0, "unhealthy": 0, "degraded": 0}), 503

class DockerMetricsCollector:
    def collect(self):
        containers = get_cached_metrics()
        up_family = GaugeMetricFamily("docker_container_up", "Whether the container is currently running", labels=["host", "service", "name", "image"])
        state_family = GaugeMetricFamily("docker_container_state", "Current container state as a labeled gauge", labels=["host", "service", "name", "state"])
        health_family = GaugeMetricFamily("docker_container_health_status", "Current container health status as a labeled gauge", labels=["host", "service", "name", "health"])
        present_family = GaugeMetricFamily("docker_container_present", "Whether the container exists in Docker inventory", labels=["host", "service", "name", "image"])
        for item in containers:
            host = HOSTNAME
            service = item["service"]
            name = item["name"]
            image = item["image"]
            up_family.add_metric([host, service, name, image], 1 if item["state"] == "running" else 0)
            state_family.add_metric([host, service, name, item["state"]], 1)
            health_family.add_metric([host, service, name, item["health"]], 1)
            present_family.add_metric([host, service, name, image], 1)
        yield up_family
        yield state_family
        yield health_family
        yield present_family

@app.route("/metrics")
def metrics():
    registry = CollectorRegistry()
    registry.register(DockerMetricsCollector())
    return Response(generate_latest(registry), mimetype=CONTENT_TYPE_LATEST)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=False)
