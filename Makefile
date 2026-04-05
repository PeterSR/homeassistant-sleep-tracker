HA_HOST     := homeassistant
HA_PATH     := /config/custom_components/sleep_tracker
FRONTEND    := frontend
COMPONENT   := custom_components/sleep_tracker
VERSION     := $(shell python -c "import json; print(json.load(open('$(COMPONENT)/manifest.json'))['version'])")

.PHONY: build deploy deploy-prod restart dev deploy-frontend deploy-backend clean logs sync-version

## Sync package.json version from manifest.json
sync-version:
	@python -c "import json; \
	v='$(VERSION)'; \
	p='$(FRONTEND)/package.json'; \
	m=json.load(open(p)); m['version']=v; json.dump(m,open(p,'w'),indent=2); \
	print(f'Versions set to {v}')"

## Build frontend bundle
build: sync-version
	cd $(FRONTEND) && npm run build

## Deploy integration to HA (builds frontend first, enables dev mode)
deploy: build
	rsync -av --delete \
		--exclude '__pycache__' \
		--exclude '*.pyc' \
		$(COMPONENT)/ $(HA_HOST):$(HA_PATH)/
	ssh $(HA_HOST) "touch $(HA_PATH)/.dev"

## Restart Home Assistant after deploy
restart:
	ssh $(HA_HOST) "ha core restart"

## Build, deploy, and restart in one step
dev: deploy restart

## Deploy production (no dev mode)
deploy-prod: build
	rsync -av --delete \
		--exclude '__pycache__' \
		--exclude '*.pyc' \
		$(COMPONENT)/ $(HA_HOST):$(HA_PATH)/
	ssh $(HA_HOST) "rm -f $(HA_PATH)/.dev"

## Deploy frontend only (build + sync just the bundle)
deploy-frontend: build
	rsync -av $(COMPONENT)/frontend/dist/ $(HA_HOST):$(HA_PATH)/frontend/dist/

## Deploy backend-only (skip frontend build)
deploy-backend:
	rsync -av --delete \
		--exclude '__pycache__' \
		--exclude '*.pyc' \
		--exclude 'frontend/dist' \
		$(COMPONENT)/ $(HA_HOST):$(HA_PATH)/

## Tail HA logs (filtered to sleep_tracker)
logs:
	ssh $(HA_HOST) "ha core logs" 2>&1 | grep -i sleep_tracker

## Remove integration from HA
clean:
	ssh $(HA_HOST) "rm -rf $(HA_PATH)"
