module.exports = {
  "root": true,
  "extends": "eslint:recommended",
  "env": {
    "mocha": true,
    "node": true,
    "es6": true
  },
  "rules": {
    "eqeqeq": ["error", "smart"],
    "max-statements": ["error", 50],
    "max-len": ["error", 160, { "ignoreRegExpLiterals": true }],
    "eol-last": ["error", "always"],
    "semi": ["error", "always"],
    "indent": ["error", 4, { "SwitchCase": 1 }],
    "no-control-regex": 0,
    "space-before-function-paren": ["error", {
      "anonymous": "always",
      "named": "never",
      "asyncArrow": "always"
    }],
    "quote-props": ["error", "as-needed"]
  },
  "parserOptions": {
    "ecmaVersion": 2018
  },
  "globals": {
    "BigInt": true
  }
}