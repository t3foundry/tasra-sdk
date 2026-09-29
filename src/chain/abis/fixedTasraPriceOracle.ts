// Contract ABI data is refreshed from the contract build artifacts.
// Source: contracts/out/FixedTasraPriceOracle.sol/FixedTasraPriceOracle.json (`abi` field).

/** FixedTasraPriceOracle contract interface for converting TSRA amounts using the configured fixed exchange rate. */
export const fixedTasraPriceOracleAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "tsraPerEur_",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "eurCentsForTsra",
    "inputs": [
      {
        "name": "tsraAmount",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tsraForEurCents",
    "inputs": [
      {
        "name": "eurCents",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tsraPerEur",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "error",
    "name": "ZeroRate",
    "inputs": []
  }
] as const
