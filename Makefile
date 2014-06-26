## TESTS

test:
	./node_modules/.bin/mocha test/*.test.js --timeout 5000 --reporter spec

.PHONY: test
