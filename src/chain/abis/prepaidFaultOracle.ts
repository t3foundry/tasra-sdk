// Contract ABI data is refreshed from the contract build artifacts.
// Source: contracts/out/PrepaidFaultOracle.sol/PrepaidFaultOracle.json (`abi` field).

/** PrepaidFaultOracle contract interface for threshold-signed prepaid fault verdicts and their slashing resolutions. */
export const prepaidFaultOracleAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "settlement_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "nodeRegistry_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "beacon_",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "rates_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "MAX_VERDICT_LIFETIME",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint64",
        "internalType": "uint64"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "beacon",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IPrepaidFaultBeacon"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "contest",
    "inputs": [
      {
        "name": "verdict",
        "type": "tuple",
        "internalType": "struct PrepaidFaultOracle.Verdict",
        "components": [
          {
            "name": "slotId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "requestId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "batchId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "offender",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "beneficiary",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "kind",
            "type": "uint8",
            "internalType": "enum PrepaidFaultOracle.FaultKind"
          },
          {
            "name": "epoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "deadline",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      },
      {
        "name": "signature",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "nodeRegistry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract NodeRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "rates",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IPrepaidFaultRates"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "resolutionId",
    "inputs": [
      {
        "name": "slotId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "batchId",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "offender",
        "type": "address",
        "internalType": "address"
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
  },
  {
    "type": "function",
    "name": "resolved",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "settlement",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract IPrepaidFaultSettlement"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "verdictDigest",
    "inputs": [
      {
        "name": "verdict",
        "type": "tuple",
        "internalType": "struct PrepaidFaultOracle.Verdict",
        "components": [
          {
            "name": "slotId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "requestId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "batchId",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "evidenceHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "offender",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "beneficiary",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "kind",
            "type": "uint8",
            "internalType": "enum PrepaidFaultOracle.FaultKind"
          },
          {
            "name": "epoch",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "deadline",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
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
  },
  {
    "type": "event",
    "name": "PrepaidFaultResolved",
    "inputs": [
      {
        "name": "resolution",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "slotId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "requestId",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "batchId",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "evidenceHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "offender",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "beneficiary",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "kind",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum PrepaidFaultOracle.FaultKind"
      },
      {
        "name": "epoch",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "taken",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AlreadyResolved",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "HashToCurveExhausted",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidBeneficiary",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidDeadline",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidRates",
    "inputs": []
  },
  {
    "type": "error",
    "name": "InvalidSubject",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PrecompileFailed",
    "inputs": [
      {
        "name": "precompile",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  {
    "type": "error",
    "name": "RequestNotSettled",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongBatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongDeployment",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongEpoch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  }
] as const
