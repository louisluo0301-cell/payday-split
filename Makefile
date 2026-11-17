.PHONY: test build fmt web demo clean

test:
	forge test -vv

build:
	forge build

fmt:
	forge fmt

web:
	cd web && npm install && npm run build

demo:
	pwsh ./script/local-demo.ps1

clean:
	forge clean
	rm -rf web/dist
