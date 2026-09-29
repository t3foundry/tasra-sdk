// Contract ABI data is refreshed from the contract build artifacts.
// Source: contracts/out/PrevrandaoSaltBeacon.sol/PrevrandaoSaltBeacon.json (`abi` field).

/** PrevrandaoSaltBeacon contract interface for chain-randomness-derived committee seeds. */
export const prevrandaoSaltBeaconAbi = [
  {
    "type": "function",
    "name": "randomFor",
    "inputs": [
      {
        "name": "salt",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  }
] as const
