# Devices. Every recipe takes an id from dna-network.yaml and runs that kind's driver.

set shell := ["zsh", "-cu"]
set positional-arguments
set working-directory := "../../apps/dna-cli"

net := "NODE_NO_WARNINGS=1 npx tsx src/main.ts net"

# List device commands
[default]
default:
    @just --list net

# Probe every device, or one
status *DEVICE:
    {{ net }} status "$@"

# Bring a device online (idempotent)
up DEVICE:
    {{ net }} up "$1"

# Sync code to a device and restart
deploy DEVICE:
    {{ net }} deploy "$1"

# Tail a device log: api or cron
logs DEVICE APP="api" LINES="40":
    {{ net }} logs "$1" "$2" "$3"

# Restart a device's API service
restart DEVICE:
    {{ net }} restart "$1"

# Stop a device's API service
down DEVICE:
    {{ net }} down "$1"

# Crontab on a device: install, remove, status
cron DEVICE ACTION="status":
    {{ net }} cron "$1" "$2"

# Check healthz, 401 and the scope matrix
probe DEVICE:
    {{ net }} probe "$1"

# Open the ssh tunnel to a private device
tunnel DEVICE:
    {{ net }} tunnel "$1"

# Open a device's UI in the browser
browser DEVICE:
    {{ net }} browser "$1"

# Map table: every device, its kind, API URL, laptop hub port and UI URL
inventory:
    {{ net }} inventory

# Delete an exe-dev VM named in the YAML
destroy DEVICE:
    {{ net }} destroy "$1"

# Run one driver step on a device
step VERB DEVICE:
    {{ net }} step "$1" "$2"
