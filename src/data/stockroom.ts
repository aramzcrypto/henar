/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/stockroom.json`.
 */
export type Stockroom = {
  "address": "7EMrgJNodNBmuQBg3cv9ASDUmXQFYp1VRiHcCzUMaC7E",
  "metadata": {
    "name": "stockroom",
    "version": "0.1.0",
    "spec": "0.1.0"
  },
  "instructions": [
    {
      "name": "acceptAdmin",
      "discriminator": [
        112,
        42,
        45,
        90,
        116,
        181,
        13,
        170
      ],
      "accounts": [
        {
          "name": "pendingAdmin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "activateManifest",
      "discriminator": [
        33,
        105,
        117,
        235,
        43,
        244,
        36,
        152
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "manifest"
          ]
        },
        {
          "name": "manifest",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "appendManifest",
      "discriminator": [
        212,
        148,
        34,
        70,
        1,
        252,
        58,
        30
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "manifest"
          ]
        },
        {
          "name": "manifest",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "stocks",
          "type": {
            "vec": {
              "defined": {
                "name": "stockSpec"
              }
            }
          }
        }
      ]
    },
    {
      "name": "bankLucky",
      "discriminator": [
        192,
        202,
        67,
        83,
        10,
        154,
        152,
        40
      ],
      "accounts": [
        {
          "name": "cash",
          "accounts": [
            {
              "name": "pack",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      112,
                      97,
                      99,
                      107
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "pack.batch",
                    "account": "pack"
                  },
                  {
                    "kind": "account",
                    "path": "pack.index",
                    "account": "pack"
                  }
                ]
              }
            },
            {
              "name": "pool",
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      108,
                      117,
                      99,
                      107,
                      121,
                      45,
                      112,
                      111,
                      111,
                      108
                    ]
                  }
                ]
              }
            },
            {
              "name": "usdc",
              "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            },
            {
              "name": "poolCash",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "account",
                    "path": "pool"
                  },
                  {
                    "kind": "const",
                    "value": [
                      6,
                      221,
                      246,
                      225,
                      215,
                      101,
                      161,
                      147,
                      217,
                      203,
                      225,
                      70,
                      206,
                      235,
                      121,
                      172,
                      28,
                      180,
                      133,
                      237,
                      95,
                      91,
                      55,
                      145,
                      58,
                      140,
                      245,
                      133,
                      126,
                      255,
                      0,
                      169
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "usdc"
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    140,
                    151,
                    37,
                    143,
                    78,
                    36,
                    137,
                    241,
                    187,
                    61,
                    16,
                    41,
                    20,
                    142,
                    13,
                    131,
                    11,
                    90,
                    19,
                    153,
                    218,
                    255,
                    16,
                    132,
                    4,
                    142,
                    123,
                    216,
                    219,
                    233,
                    248,
                    89
                  ]
                }
              }
            },
            {
              "name": "packCash",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "account",
                    "path": "pack"
                  },
                  {
                    "kind": "const",
                    "value": [
                      6,
                      221,
                      246,
                      225,
                      215,
                      101,
                      161,
                      147,
                      217,
                      203,
                      225,
                      70,
                      206,
                      235,
                      121,
                      172,
                      28,
                      180,
                      133,
                      237,
                      95,
                      91,
                      55,
                      145,
                      58,
                      140,
                      245,
                      133,
                      126,
                      255,
                      0,
                      169
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "usdc"
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    140,
                    151,
                    37,
                    143,
                    78,
                    36,
                    137,
                    241,
                    187,
                    61,
                    16,
                    41,
                    20,
                    142,
                    13,
                    131,
                    11,
                    90,
                    19,
                    153,
                    218,
                    255,
                    16,
                    132,
                    4,
                    142,
                    123,
                    216,
                    219,
                    233,
                    248,
                    89
                  ]
                }
              }
            },
            {
              "name": "tokenProgram",
              "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            }
          ]
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "ownerCash",
          "writable": true
        },
        {
          "name": "randomness",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "buyBatch",
      "discriminator": [
        90,
        48,
        179,
        43,
        144,
        67,
        176,
        103
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "manifest"
          ]
        },
        {
          "name": "manifest"
        },
        {
          "name": "batch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "ownerCash",
          "writable": true
        },
        {
          "name": "batchCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "batch"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "count",
          "type": "u64"
        },
        {
          "name": "slippageBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "cancelOrder",
      "discriminator": [
        95,
        129,
        237,
        240,
        8,
        49,
        223,
        132
      ],
      "accounts": [
        {
          "name": "actor",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "position",
            "manifest"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "position.owner",
                "account": "position"
              },
              {
                "kind": "account",
                "path": "position.id",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "manifest"
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "ownerCash",
          "writable": true
        },
        {
          "name": "cash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "position"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "sharesMint"
        },
        {
          "name": "shares",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "position"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "sharesMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "withdrawAccounts",
          "type": "u16"
        },
        {
          "name": "minRedeemed",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claimYield",
      "discriminator": [
        49,
        74,
        111,
        7,
        186,
        22,
        61,
        165
      ],
      "accounts": [
        {
          "name": "actor",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "position",
            "manifest"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "position.owner",
                "account": "position"
              },
              {
                "kind": "account",
                "path": "position.id",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "manifest"
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "ownerCash",
          "writable": true
        },
        {
          "name": "cash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "position"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "sharesMint"
        },
        {
          "name": "shares",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "position"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "sharesMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "configureAccess",
      "discriminator": [
        67,
        51,
        26,
        174,
        192,
        82,
        74,
        208
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "products",
          "type": "u8"
        },
        {
          "name": "pilotOwner",
          "type": "pubkey"
        },
        {
          "name": "admissionLimit",
          "type": "u64"
        }
      ]
    },
    {
      "name": "configureLucky",
      "discriminator": [
        6,
        120,
        64,
        118,
        247,
        77,
        131,
        46
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  117,
                  99,
                  107,
                  121,
                  45,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "poolCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "enabled",
          "type": "bool"
        },
        {
          "name": "maxStake",
          "type": "u64"
        }
      ]
    },
    {
      "name": "configurePackExecution",
      "discriminator": [
        24,
        9,
        152,
        200,
        134,
        100,
        135,
        159
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "execution",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  99,
                  107,
                  45,
                  101,
                  120,
                  101,
                  99,
                  117,
                  116,
                  105,
                  111,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "authority",
          "type": "pubkey"
        },
        {
          "name": "enabled",
          "type": "bool"
        },
        {
          "name": "maxBudget",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createManifest",
      "discriminator": [
        223,
        153,
        230,
        62,
        181,
        232,
        110,
        143
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "manifest",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  110,
                  105,
                  102,
                  101,
                  115,
                  116
                ]
              },
              {
                "kind": "arg",
                "path": "version"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "version",
          "type": "u64"
        },
        {
          "name": "stocks",
          "type": {
            "vec": {
              "defined": {
                "name": "stockSpec"
              }
            }
          }
        }
      ]
    },
    {
      "name": "createPosition",
      "discriminator": [
        48,
        215,
        197,
        153,
        96,
        203,
        180,
        133
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "manifest"
          ]
        },
        {
          "name": "manifest"
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "ownerCash",
          "writable": true
        },
        {
          "name": "cash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "position"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "sharesMint"
        },
        {
          "name": "shares",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "position"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "sharesMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "minShares",
          "type": "u64"
        },
        {
          "name": "terms",
          "type": {
            "defined": {
              "name": "positionTerms"
            }
          }
        }
      ]
    },
    {
      "name": "depositMore",
      "discriminator": [
        85,
        207,
        167,
        0,
        97,
        100,
        35,
        107
      ],
      "accounts": [
        {
          "name": "actor",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "position",
            "manifest"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "position.owner",
                "account": "position"
              },
              {
                "kind": "account",
                "path": "position.id",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "manifest"
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "ownerCash",
          "writable": true
        },
        {
          "name": "cash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "position"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "sharesMint"
        },
        {
          "name": "shares",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "position"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "sharesMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "minShares",
          "type": "u64"
        }
      ]
    },
    {
      "name": "fillOrder",
      "discriminator": [
        232,
        122,
        115,
        25,
        199,
        143,
        136,
        162
      ],
      "accounts": [
        {
          "name": "base",
          "accounts": [
            {
              "name": "actor",
              "writable": true,
              "signer": true
            },
            {
              "name": "config",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      99,
                      111,
                      110,
                      102,
                      105,
                      103
                    ]
                  }
                ]
              },
              "relations": [
                "position",
                "manifest"
              ]
            },
            {
              "name": "position",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      112,
                      111,
                      115,
                      105,
                      116,
                      105,
                      111,
                      110
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "position.owner",
                    "account": "position"
                  },
                  {
                    "kind": "account",
                    "path": "position.id",
                    "account": "position"
                  }
                ]
              }
            },
            {
              "name": "manifest"
            },
            {
              "name": "usdc",
              "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            },
            {
              "name": "ownerCash",
              "writable": true
            },
            {
              "name": "cash",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "account",
                    "path": "position"
                  },
                  {
                    "kind": "const",
                    "value": [
                      6,
                      221,
                      246,
                      225,
                      215,
                      101,
                      161,
                      147,
                      217,
                      203,
                      225,
                      70,
                      206,
                      235,
                      121,
                      172,
                      28,
                      180,
                      133,
                      237,
                      95,
                      91,
                      55,
                      145,
                      58,
                      140,
                      245,
                      133,
                      126,
                      255,
                      0,
                      169
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "usdc"
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    140,
                    151,
                    37,
                    143,
                    78,
                    36,
                    137,
                    241,
                    187,
                    61,
                    16,
                    41,
                    20,
                    142,
                    13,
                    131,
                    11,
                    90,
                    19,
                    153,
                    218,
                    255,
                    16,
                    132,
                    4,
                    142,
                    123,
                    216,
                    219,
                    233,
                    248,
                    89
                  ]
                }
              }
            },
            {
              "name": "sharesMint"
            },
            {
              "name": "shares",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "account",
                    "path": "position"
                  },
                  {
                    "kind": "const",
                    "value": [
                      6,
                      221,
                      246,
                      225,
                      215,
                      101,
                      161,
                      147,
                      217,
                      203,
                      225,
                      70,
                      206,
                      235,
                      121,
                      172,
                      28,
                      180,
                      133,
                      237,
                      95,
                      91,
                      55,
                      145,
                      58,
                      140,
                      245,
                      133,
                      126,
                      255,
                      0,
                      169
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "sharesMint"
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    140,
                    151,
                    37,
                    143,
                    78,
                    36,
                    137,
                    241,
                    187,
                    61,
                    16,
                    41,
                    20,
                    142,
                    13,
                    131,
                    11,
                    90,
                    19,
                    153,
                    218,
                    255,
                    16,
                    132,
                    4,
                    142,
                    123,
                    216,
                    219,
                    233,
                    248,
                    89
                  ]
                }
              }
            },
            {
              "name": "treasury",
              "writable": true
            },
            {
              "name": "tokenProgram",
              "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            }
          ]
        },
        {
          "name": "stockMint"
        },
        {
          "name": "solverStock",
          "writable": true
        },
        {
          "name": "ownerStock",
          "writable": true
        },
        {
          "name": "stockProgram"
        },
        {
          "name": "stockPrice"
        },
        {
          "name": "usdcPrice"
        },
        {
          "name": "solverCash",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "delivered",
          "type": "u64"
        },
        {
          "name": "withdrawAccounts",
          "type": "u16"
        },
        {
          "name": "minRedeemed",
          "type": "u64"
        },
        {
          "name": "minShares",
          "type": "u64"
        },
        {
          "name": "stockTransferAccounts",
          "type": "u16"
        }
      ]
    },
    {
      "name": "giftBatch",
      "discriminator": [
        220,
        7,
        163,
        110,
        23,
        34,
        213,
        10
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "batch"
          ]
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "batch"
          ]
        },
        {
          "name": "batch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "batch.creator",
                "account": "packBatch"
              },
              {
                "kind": "account",
                "path": "batch.id",
                "account": "packBatch"
              }
            ]
          }
        },
        {
          "name": "gift",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "batchCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "batch"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "giftCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "gift"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u64"
        },
        {
          "name": "count",
          "type": "u64"
        },
        {
          "name": "recipient",
          "type": "pubkey"
        },
        {
          "name": "message",
          "type": "string"
        }
      ]
    },
    {
      "name": "harvest",
      "discriminator": [
        228,
        241,
        31,
        182,
        53,
        169,
        59,
        199
      ],
      "accounts": [
        {
          "name": "actor",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "position",
            "manifest"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "position.owner",
                "account": "position"
              },
              {
                "kind": "account",
                "path": "position.id",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "manifest"
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "ownerCash",
          "writable": true
        },
        {
          "name": "cash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "position"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "sharesMint"
        },
        {
          "name": "shares",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "position"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "sharesMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "withdrawAccounts",
          "type": "u16"
        },
        {
          "name": "minRedeemed",
          "type": "u64"
        },
        {
          "name": "minShares",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "programData"
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "treasury"
        },
        {
          "name": "vault"
        },
        {
          "name": "sharesMint"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "terms",
          "type": {
            "defined": {
              "name": "configTerms"
            }
          }
        }
      ]
    },
    {
      "name": "initializeLucky",
      "discriminator": [
        210,
        238,
        130,
        29,
        193,
        113,
        151,
        110
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  117,
                  99,
                  107,
                  121,
                  45,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "poolCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "openLucky",
      "discriminator": [
        148,
        231,
        7,
        19,
        57,
        137,
        154,
        129
      ],
      "accounts": [
        {
          "name": "base",
          "accounts": [
            {
              "name": "owner",
              "writable": true,
              "signer": true,
              "relations": [
                "batch"
              ]
            },
            {
              "name": "config",
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      99,
                      111,
                      110,
                      102,
                      105,
                      103
                    ]
                  }
                ]
              },
              "relations": [
                "batch"
              ]
            },
            {
              "name": "batch",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      98,
                      97,
                      116,
                      99,
                      104
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "batch.creator",
                    "account": "packBatch"
                  },
                  {
                    "kind": "account",
                    "path": "batch.id",
                    "account": "packBatch"
                  }
                ]
              }
            },
            {
              "name": "pack",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      112,
                      97,
                      99,
                      107
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "batch"
                  },
                  {
                    "kind": "arg",
                    "path": "index"
                  }
                ]
              }
            },
            {
              "name": "usdc",
              "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            },
            {
              "name": "batchCash",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "account",
                    "path": "batch"
                  },
                  {
                    "kind": "const",
                    "value": [
                      6,
                      221,
                      246,
                      225,
                      215,
                      101,
                      161,
                      147,
                      217,
                      203,
                      225,
                      70,
                      206,
                      235,
                      121,
                      172,
                      28,
                      180,
                      133,
                      237,
                      95,
                      91,
                      55,
                      145,
                      58,
                      140,
                      245,
                      133,
                      126,
                      255,
                      0,
                      169
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "usdc"
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    140,
                    151,
                    37,
                    143,
                    78,
                    36,
                    137,
                    241,
                    187,
                    61,
                    16,
                    41,
                    20,
                    142,
                    13,
                    131,
                    11,
                    90,
                    19,
                    153,
                    218,
                    255,
                    16,
                    132,
                    4,
                    142,
                    123,
                    216,
                    219,
                    233,
                    248,
                    89
                  ]
                }
              }
            },
            {
              "name": "packCash",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "account",
                    "path": "pack"
                  },
                  {
                    "kind": "const",
                    "value": [
                      6,
                      221,
                      246,
                      225,
                      215,
                      101,
                      161,
                      147,
                      217,
                      203,
                      225,
                      70,
                      206,
                      235,
                      121,
                      172,
                      28,
                      180,
                      133,
                      237,
                      95,
                      91,
                      55,
                      145,
                      58,
                      140,
                      245,
                      133,
                      126,
                      255,
                      0,
                      169
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "usdc"
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    140,
                    151,
                    37,
                    143,
                    78,
                    36,
                    137,
                    241,
                    187,
                    61,
                    16,
                    41,
                    20,
                    142,
                    13,
                    131,
                    11,
                    90,
                    19,
                    153,
                    218,
                    255,
                    16,
                    132,
                    4,
                    142,
                    123,
                    216,
                    219,
                    233,
                    248,
                    89
                  ]
                }
              }
            },
            {
              "name": "network",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      111,
                      114,
                      97,
                      111,
                      45,
                      118,
                      114,
                      102,
                      45,
                      110,
                      101,
                      116,
                      119,
                      111,
                      114,
                      107,
                      45,
                      99,
                      111,
                      110,
                      102,
                      105,
                      103,
                      117,
                      114,
                      97,
                      116,
                      105,
                      111,
                      110
                    ]
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    7,
                    71,
                    177,
                    26,
                    250,
                    145,
                    180,
                    209,
                    249,
                    34,
                    242,
                    123,
                    14,
                    186,
                    193,
                    218,
                    178,
                    59,
                    33,
                    41,
                    164,
                    190,
                    243,
                    79,
                    50,
                    164,
                    123,
                    88,
                    245,
                    206,
                    252,
                    120
                  ]
                }
              }
            },
            {
              "name": "oraoTreasury",
              "writable": true
            },
            {
              "name": "randomness",
              "writable": true
            },
            {
              "name": "oraoProgram",
              "address": "VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y"
            },
            {
              "name": "tokenProgram",
              "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            },
            {
              "name": "associatedTokenProgram",
              "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
            },
            {
              "name": "systemProgram",
              "address": "11111111111111111111111111111111"
            }
          ]
        },
        {
          "name": "pool",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  117,
                  99,
                  107,
                  121,
                  45,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "poolCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "base.usdc",
                "account": "openPack"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasury",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u64"
        },
        {
          "name": "nonce",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "openPack",
      "discriminator": [
        75,
        203,
        144,
        65,
        63,
        253,
        103,
        85
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "batch"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "batch"
          ]
        },
        {
          "name": "batch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "batch.creator",
                "account": "packBatch"
              },
              {
                "kind": "account",
                "path": "batch.id",
                "account": "packBatch"
              }
            ]
          }
        },
        {
          "name": "pack",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "batch"
              },
              {
                "kind": "arg",
                "path": "index"
              }
            ]
          }
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "batchCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "batch"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "packCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pack"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "network",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  111,
                  45,
                  118,
                  114,
                  102,
                  45,
                  110,
                  101,
                  116,
                  119,
                  111,
                  114,
                  107,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  117,
                  114,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                7,
                71,
                177,
                26,
                250,
                145,
                180,
                209,
                249,
                34,
                242,
                123,
                14,
                186,
                193,
                218,
                178,
                59,
                33,
                41,
                164,
                190,
                243,
                79,
                50,
                164,
                123,
                88,
                245,
                206,
                252,
                120
              ]
            }
          }
        },
        {
          "name": "oraoTreasury",
          "writable": true
        },
        {
          "name": "randomness",
          "writable": true
        },
        {
          "name": "oraoProgram",
          "address": "VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "index",
          "type": "u64"
        },
        {
          "name": "nonce",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "proposeAdmin",
      "discriminator": [
        121,
        214,
        199,
        212,
        87,
        39,
        117,
        234
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "pending",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "refundBatch",
      "discriminator": [
        227,
        54,
        194,
        2,
        78,
        8,
        104,
        29
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "batch"
          ]
        },
        {
          "name": "batch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "batch.creator",
                "account": "packBatch"
              },
              {
                "kind": "account",
                "path": "batch.id",
                "account": "packBatch"
              }
            ]
          }
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "ownerCash",
          "writable": true
        },
        {
          "name": "batchCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "batch"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "count",
          "type": "u64"
        }
      ]
    },
    {
      "name": "refundLucky",
      "discriminator": [
        85,
        197,
        172,
        178,
        203,
        237,
        91,
        89
      ],
      "accounts": [
        {
          "name": "cash",
          "accounts": [
            {
              "name": "pack",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      112,
                      97,
                      99,
                      107
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "pack.batch",
                    "account": "pack"
                  },
                  {
                    "kind": "account",
                    "path": "pack.index",
                    "account": "pack"
                  }
                ]
              }
            },
            {
              "name": "pool",
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      108,
                      117,
                      99,
                      107,
                      121,
                      45,
                      112,
                      111,
                      111,
                      108
                    ]
                  }
                ]
              }
            },
            {
              "name": "usdc",
              "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            },
            {
              "name": "poolCash",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "account",
                    "path": "pool"
                  },
                  {
                    "kind": "const",
                    "value": [
                      6,
                      221,
                      246,
                      225,
                      215,
                      101,
                      161,
                      147,
                      217,
                      203,
                      225,
                      70,
                      206,
                      235,
                      121,
                      172,
                      28,
                      180,
                      133,
                      237,
                      95,
                      91,
                      55,
                      145,
                      58,
                      140,
                      245,
                      133,
                      126,
                      255,
                      0,
                      169
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "usdc"
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    140,
                    151,
                    37,
                    143,
                    78,
                    36,
                    137,
                    241,
                    187,
                    61,
                    16,
                    41,
                    20,
                    142,
                    13,
                    131,
                    11,
                    90,
                    19,
                    153,
                    218,
                    255,
                    16,
                    132,
                    4,
                    142,
                    123,
                    216,
                    219,
                    233,
                    248,
                    89
                  ]
                }
              }
            },
            {
              "name": "packCash",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "account",
                    "path": "pack"
                  },
                  {
                    "kind": "const",
                    "value": [
                      6,
                      221,
                      246,
                      225,
                      215,
                      101,
                      161,
                      147,
                      217,
                      203,
                      225,
                      70,
                      206,
                      235,
                      121,
                      172,
                      28,
                      180,
                      133,
                      237,
                      95,
                      91,
                      55,
                      145,
                      58,
                      140,
                      245,
                      133,
                      126,
                      255,
                      0,
                      169
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "usdc"
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    140,
                    151,
                    37,
                    143,
                    78,
                    36,
                    137,
                    241,
                    187,
                    61,
                    16,
                    41,
                    20,
                    142,
                    13,
                    131,
                    11,
                    90,
                    19,
                    153,
                    218,
                    255,
                    16,
                    132,
                    4,
                    142,
                    123,
                    216,
                    219,
                    233,
                    248,
                    89
                  ]
                }
              }
            },
            {
              "name": "tokenProgram",
              "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            }
          ]
        },
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "ownerCash",
          "writable": true
        },
        {
          "name": "randomness",
          "writable": true
        }
      ],
      "args": []
    },
    {
      "name": "refundPack",
      "discriminator": [
        108,
        93,
        170,
        157,
        72,
        116,
        157,
        48
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "pack"
          ]
        },
        {
          "name": "pack",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "pack.batch",
                "account": "pack"
              },
              {
                "kind": "account",
                "path": "pack.index",
                "account": "pack"
              }
            ]
          }
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "ownerCash",
          "writable": true
        },
        {
          "name": "packCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pack"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "resolveLucky",
      "discriminator": [
        207,
        109,
        68,
        39,
        10,
        239,
        121,
        217
      ],
      "accounts": [
        {
          "name": "cash",
          "accounts": [
            {
              "name": "pack",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      112,
                      97,
                      99,
                      107
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "pack.batch",
                    "account": "pack"
                  },
                  {
                    "kind": "account",
                    "path": "pack.index",
                    "account": "pack"
                  }
                ]
              }
            },
            {
              "name": "pool",
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      108,
                      117,
                      99,
                      107,
                      121,
                      45,
                      112,
                      111,
                      111,
                      108
                    ]
                  }
                ]
              }
            },
            {
              "name": "usdc",
              "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            },
            {
              "name": "poolCash",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "account",
                    "path": "pool"
                  },
                  {
                    "kind": "const",
                    "value": [
                      6,
                      221,
                      246,
                      225,
                      215,
                      101,
                      161,
                      147,
                      217,
                      203,
                      225,
                      70,
                      206,
                      235,
                      121,
                      172,
                      28,
                      180,
                      133,
                      237,
                      95,
                      91,
                      55,
                      145,
                      58,
                      140,
                      245,
                      133,
                      126,
                      255,
                      0,
                      169
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "usdc"
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    140,
                    151,
                    37,
                    143,
                    78,
                    36,
                    137,
                    241,
                    187,
                    61,
                    16,
                    41,
                    20,
                    142,
                    13,
                    131,
                    11,
                    90,
                    19,
                    153,
                    218,
                    255,
                    16,
                    132,
                    4,
                    142,
                    123,
                    216,
                    219,
                    233,
                    248,
                    89
                  ]
                }
              }
            },
            {
              "name": "packCash",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "account",
                    "path": "pack"
                  },
                  {
                    "kind": "const",
                    "value": [
                      6,
                      221,
                      246,
                      225,
                      215,
                      101,
                      161,
                      147,
                      217,
                      203,
                      225,
                      70,
                      206,
                      235,
                      121,
                      172,
                      28,
                      180,
                      133,
                      237,
                      95,
                      91,
                      55,
                      145,
                      58,
                      140,
                      245,
                      133,
                      126,
                      255,
                      0,
                      169
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "usdc"
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    140,
                    151,
                    37,
                    143,
                    78,
                    36,
                    137,
                    241,
                    187,
                    61,
                    16,
                    41,
                    20,
                    142,
                    13,
                    131,
                    11,
                    90,
                    19,
                    153,
                    218,
                    255,
                    16,
                    132,
                    4,
                    142,
                    123,
                    216,
                    219,
                    233,
                    248,
                    89
                  ]
                }
              }
            },
            {
              "name": "tokenProgram",
              "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            }
          ]
        },
        {
          "name": "manifest"
        },
        {
          "name": "randomness"
        }
      ],
      "args": []
    },
    {
      "name": "resolvePack",
      "discriminator": [
        238,
        210,
        97,
        124,
        8,
        223,
        205,
        230
      ],
      "accounts": [
        {
          "name": "pack",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "pack.batch",
                "account": "pack"
              },
              {
                "kind": "account",
                "path": "pack.index",
                "account": "pack"
              }
            ]
          }
        },
        {
          "name": "manifest"
        },
        {
          "name": "randomness"
        }
      ],
      "args": []
    },
    {
      "name": "rollLucky",
      "discriminator": [
        224,
        192,
        132,
        151,
        247,
        220,
        18,
        103
      ],
      "accounts": [
        {
          "name": "base",
          "accounts": [
            {
              "name": "cash",
              "accounts": [
                {
                  "name": "pack",
                  "writable": true,
                  "pda": {
                    "seeds": [
                      {
                        "kind": "const",
                        "value": [
                          112,
                          97,
                          99,
                          107
                        ]
                      },
                      {
                        "kind": "account",
                        "path": "pack.batch",
                        "account": "pack"
                      },
                      {
                        "kind": "account",
                        "path": "pack.index",
                        "account": "pack"
                      }
                    ]
                  }
                },
                {
                  "name": "pool",
                  "pda": {
                    "seeds": [
                      {
                        "kind": "const",
                        "value": [
                          108,
                          117,
                          99,
                          107,
                          121,
                          45,
                          112,
                          111,
                          111,
                          108
                        ]
                      }
                    ]
                  }
                },
                {
                  "name": "usdc",
                  "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
                },
                {
                  "name": "poolCash",
                  "writable": true,
                  "pda": {
                    "seeds": [
                      {
                        "kind": "account",
                        "path": "pool"
                      },
                      {
                        "kind": "const",
                        "value": [
                          6,
                          221,
                          246,
                          225,
                          215,
                          101,
                          161,
                          147,
                          217,
                          203,
                          225,
                          70,
                          206,
                          235,
                          121,
                          172,
                          28,
                          180,
                          133,
                          237,
                          95,
                          91,
                          55,
                          145,
                          58,
                          140,
                          245,
                          133,
                          126,
                          255,
                          0,
                          169
                        ]
                      },
                      {
                        "kind": "account",
                        "path": "usdc"
                      }
                    ],
                    "program": {
                      "kind": "const",
                      "value": [
                        140,
                        151,
                        37,
                        143,
                        78,
                        36,
                        137,
                        241,
                        187,
                        61,
                        16,
                        41,
                        20,
                        142,
                        13,
                        131,
                        11,
                        90,
                        19,
                        153,
                        218,
                        255,
                        16,
                        132,
                        4,
                        142,
                        123,
                        216,
                        219,
                        233,
                        248,
                        89
                      ]
                    }
                  }
                },
                {
                  "name": "packCash",
                  "writable": true,
                  "pda": {
                    "seeds": [
                      {
                        "kind": "account",
                        "path": "pack"
                      },
                      {
                        "kind": "const",
                        "value": [
                          6,
                          221,
                          246,
                          225,
                          215,
                          101,
                          161,
                          147,
                          217,
                          203,
                          225,
                          70,
                          206,
                          235,
                          121,
                          172,
                          28,
                          180,
                          133,
                          237,
                          95,
                          91,
                          55,
                          145,
                          58,
                          140,
                          245,
                          133,
                          126,
                          255,
                          0,
                          169
                        ]
                      },
                      {
                        "kind": "account",
                        "path": "usdc"
                      }
                    ],
                    "program": {
                      "kind": "const",
                      "value": [
                        140,
                        151,
                        37,
                        143,
                        78,
                        36,
                        137,
                        241,
                        187,
                        61,
                        16,
                        41,
                        20,
                        142,
                        13,
                        131,
                        11,
                        90,
                        19,
                        153,
                        218,
                        255,
                        16,
                        132,
                        4,
                        142,
                        123,
                        216,
                        219,
                        233,
                        248,
                        89
                      ]
                    }
                  }
                },
                {
                  "name": "tokenProgram",
                  "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
                }
              ]
            },
            {
              "name": "owner",
              "writable": true,
              "signer": true
            },
            {
              "name": "config",
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      99,
                      111,
                      110,
                      102,
                      105,
                      103
                    ]
                  }
                ]
              }
            },
            {
              "name": "ownerCash",
              "writable": true
            },
            {
              "name": "randomness",
              "writable": true
            }
          ]
        },
        {
          "name": "network",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  97,
                  111,
                  45,
                  118,
                  114,
                  102,
                  45,
                  110,
                  101,
                  116,
                  119,
                  111,
                  114,
                  107,
                  45,
                  99,
                  111,
                  110,
                  102,
                  105,
                  103,
                  117,
                  114,
                  97,
                  116,
                  105,
                  111,
                  110
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                7,
                71,
                177,
                26,
                250,
                145,
                180,
                209,
                249,
                34,
                242,
                123,
                14,
                186,
                193,
                218,
                178,
                59,
                33,
                41,
                164,
                190,
                243,
                79,
                50,
                164,
                123,
                88,
                245,
                206,
                252,
                120
              ]
            }
          }
        },
        {
          "name": "oraoTreasury",
          "writable": true
        },
        {
          "name": "oraoProgram",
          "address": "VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "nonce",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "setPaused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setPreferences",
      "discriminator": [
        61,
        88,
        25,
        150,
        106,
        185,
        216,
        193
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "position.id",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "manifest"
        }
      ],
      "args": [
        {
          "name": "destination",
          "type": {
            "defined": {
              "name": "destination"
            }
          }
        },
        {
          "name": "autoPacks",
          "type": "bool"
        },
        {
          "name": "stockIndex",
          "type": "u16"
        }
      ]
    },
    {
      "name": "settlePack",
      "discriminator": [
        237,
        120,
        175,
        120,
        69,
        11,
        47,
        219
      ],
      "accounts": [
        {
          "name": "execution",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  99,
                  107,
                  45,
                  101,
                  120,
                  101,
                  99,
                  117,
                  116,
                  105,
                  111,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "solver",
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "pack",
            "manifest"
          ]
        },
        {
          "name": "pack",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "pack.batch",
                "account": "pack"
              },
              {
                "kind": "account",
                "path": "pack.index",
                "account": "pack"
              }
            ]
          }
        },
        {
          "name": "manifest"
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "packCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pack"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "solverCash",
          "writable": true
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "stockMint"
        },
        {
          "name": "solverStock",
          "writable": true
        },
        {
          "name": "ownerStock",
          "writable": true
        },
        {
          "name": "stockProgram"
        },
        {
          "name": "stockPrice"
        },
        {
          "name": "usdcPrice"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "delivered",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleYield",
      "discriminator": [
        64,
        28,
        44,
        24,
        43,
        204,
        58,
        215
      ],
      "accounts": [
        {
          "name": "base",
          "accounts": [
            {
              "name": "actor",
              "writable": true,
              "signer": true
            },
            {
              "name": "config",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      99,
                      111,
                      110,
                      102,
                      105,
                      103
                    ]
                  }
                ]
              },
              "relations": [
                "position",
                "manifest"
              ]
            },
            {
              "name": "position",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      112,
                      111,
                      115,
                      105,
                      116,
                      105,
                      111,
                      110
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "position.owner",
                    "account": "position"
                  },
                  {
                    "kind": "account",
                    "path": "position.id",
                    "account": "position"
                  }
                ]
              }
            },
            {
              "name": "manifest"
            },
            {
              "name": "usdc",
              "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            },
            {
              "name": "ownerCash",
              "writable": true
            },
            {
              "name": "cash",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "account",
                    "path": "position"
                  },
                  {
                    "kind": "const",
                    "value": [
                      6,
                      221,
                      246,
                      225,
                      215,
                      101,
                      161,
                      147,
                      217,
                      203,
                      225,
                      70,
                      206,
                      235,
                      121,
                      172,
                      28,
                      180,
                      133,
                      237,
                      95,
                      91,
                      55,
                      145,
                      58,
                      140,
                      245,
                      133,
                      126,
                      255,
                      0,
                      169
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "usdc"
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    140,
                    151,
                    37,
                    143,
                    78,
                    36,
                    137,
                    241,
                    187,
                    61,
                    16,
                    41,
                    20,
                    142,
                    13,
                    131,
                    11,
                    90,
                    19,
                    153,
                    218,
                    255,
                    16,
                    132,
                    4,
                    142,
                    123,
                    216,
                    219,
                    233,
                    248,
                    89
                  ]
                }
              }
            },
            {
              "name": "sharesMint"
            },
            {
              "name": "shares",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "account",
                    "path": "position"
                  },
                  {
                    "kind": "const",
                    "value": [
                      6,
                      221,
                      246,
                      225,
                      215,
                      101,
                      161,
                      147,
                      217,
                      203,
                      225,
                      70,
                      206,
                      235,
                      121,
                      172,
                      28,
                      180,
                      133,
                      237,
                      95,
                      91,
                      55,
                      145,
                      58,
                      140,
                      245,
                      133,
                      126,
                      255,
                      0,
                      169
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "sharesMint"
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    140,
                    151,
                    37,
                    143,
                    78,
                    36,
                    137,
                    241,
                    187,
                    61,
                    16,
                    41,
                    20,
                    142,
                    13,
                    131,
                    11,
                    90,
                    19,
                    153,
                    218,
                    255,
                    16,
                    132,
                    4,
                    142,
                    123,
                    216,
                    219,
                    233,
                    248,
                    89
                  ]
                }
              }
            },
            {
              "name": "treasury",
              "writable": true
            },
            {
              "name": "tokenProgram",
              "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            }
          ]
        },
        {
          "name": "stockMint"
        },
        {
          "name": "solverStock",
          "writable": true
        },
        {
          "name": "ownerStock",
          "writable": true
        },
        {
          "name": "stockProgram"
        },
        {
          "name": "stockPrice"
        },
        {
          "name": "usdcPrice"
        },
        {
          "name": "solverCash",
          "writable": true
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "delivered",
          "type": "u64"
        }
      ]
    },
    {
      "name": "swapPack",
      "discriminator": [
        122,
        75,
        30,
        230,
        10,
        113,
        64,
        63
      ],
      "accounts": [
        {
          "name": "quoteAuthority",
          "signer": true
        },
        {
          "name": "execution",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  99,
                  107,
                  45,
                  101,
                  120,
                  101,
                  99,
                  117,
                  116,
                  105,
                  111,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "pack",
            "manifest"
          ]
        },
        {
          "name": "pack",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  99,
                  107
                ]
              },
              {
                "kind": "account",
                "path": "pack.batch",
                "account": "pack"
              },
              {
                "kind": "account",
                "path": "pack.index",
                "account": "pack"
              }
            ]
          }
        },
        {
          "name": "manifest"
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "packCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pack"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "stockMint"
        },
        {
          "name": "ownerStock",
          "writable": true
        },
        {
          "name": "stockProgram"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "jupiter",
          "address": "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
        }
      ],
      "args": [
        {
          "name": "quotedOutput",
          "type": "u64"
        },
        {
          "name": "minimumOutput",
          "type": "u64"
        },
        {
          "name": "quotedAt",
          "type": "i64"
        },
        {
          "name": "route",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "swapPosition",
      "discriminator": [
        109,
        143,
        91,
        230,
        53,
        67,
        177,
        79
      ],
      "accounts": [
        {
          "name": "base",
          "accounts": [
            {
              "name": "actor",
              "writable": true,
              "signer": true
            },
            {
              "name": "config",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      99,
                      111,
                      110,
                      102,
                      105,
                      103
                    ]
                  }
                ]
              },
              "relations": [
                "position",
                "manifest"
              ]
            },
            {
              "name": "position",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "const",
                    "value": [
                      112,
                      111,
                      115,
                      105,
                      116,
                      105,
                      111,
                      110
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "position.owner",
                    "account": "position"
                  },
                  {
                    "kind": "account",
                    "path": "position.id",
                    "account": "position"
                  }
                ]
              }
            },
            {
              "name": "manifest"
            },
            {
              "name": "usdc",
              "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            },
            {
              "name": "ownerCash",
              "writable": true
            },
            {
              "name": "cash",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "account",
                    "path": "position"
                  },
                  {
                    "kind": "const",
                    "value": [
                      6,
                      221,
                      246,
                      225,
                      215,
                      101,
                      161,
                      147,
                      217,
                      203,
                      225,
                      70,
                      206,
                      235,
                      121,
                      172,
                      28,
                      180,
                      133,
                      237,
                      95,
                      91,
                      55,
                      145,
                      58,
                      140,
                      245,
                      133,
                      126,
                      255,
                      0,
                      169
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "usdc"
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    140,
                    151,
                    37,
                    143,
                    78,
                    36,
                    137,
                    241,
                    187,
                    61,
                    16,
                    41,
                    20,
                    142,
                    13,
                    131,
                    11,
                    90,
                    19,
                    153,
                    218,
                    255,
                    16,
                    132,
                    4,
                    142,
                    123,
                    216,
                    219,
                    233,
                    248,
                    89
                  ]
                }
              }
            },
            {
              "name": "sharesMint"
            },
            {
              "name": "shares",
              "writable": true,
              "pda": {
                "seeds": [
                  {
                    "kind": "account",
                    "path": "position"
                  },
                  {
                    "kind": "const",
                    "value": [
                      6,
                      221,
                      246,
                      225,
                      215,
                      101,
                      161,
                      147,
                      217,
                      203,
                      225,
                      70,
                      206,
                      235,
                      121,
                      172,
                      28,
                      180,
                      133,
                      237,
                      95,
                      91,
                      55,
                      145,
                      58,
                      140,
                      245,
                      133,
                      126,
                      255,
                      0,
                      169
                    ]
                  },
                  {
                    "kind": "account",
                    "path": "sharesMint"
                  }
                ],
                "program": {
                  "kind": "const",
                  "value": [
                    140,
                    151,
                    37,
                    143,
                    78,
                    36,
                    137,
                    241,
                    187,
                    61,
                    16,
                    41,
                    20,
                    142,
                    13,
                    131,
                    11,
                    90,
                    19,
                    153,
                    218,
                    255,
                    16,
                    132,
                    4,
                    142,
                    123,
                    216,
                    219,
                    233,
                    248,
                    89
                  ]
                }
              }
            },
            {
              "name": "treasury",
              "writable": true
            },
            {
              "name": "tokenProgram",
              "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
            }
          ]
        },
        {
          "name": "execution",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  99,
                  107,
                  45,
                  101,
                  120,
                  101,
                  99,
                  117,
                  116,
                  105,
                  111,
                  110
                ]
              }
            ]
          }
        },
        {
          "name": "stockMint"
        },
        {
          "name": "ownerStock",
          "writable": true
        },
        {
          "name": "stockProgram"
        },
        {
          "name": "jupiter",
          "address": "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4"
        }
      ],
      "args": [
        {
          "name": "terms",
          "type": {
            "defined": {
              "name": "positionSwapTerms"
            }
          }
        },
        {
          "name": "route",
          "type": "bytes"
        }
      ]
    },
    {
      "name": "withdrawLuckyReserve",
      "discriminator": [
        177,
        111,
        43,
        6,
        109,
        85,
        125,
        124
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "pool"
          ]
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  117,
                  99,
                  107,
                  121,
                  45,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "poolCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawPrincipal",
      "discriminator": [
        6,
        59,
        175,
        16,
        210,
        146,
        119,
        63
      ],
      "accounts": [
        {
          "name": "actor",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "position",
            "manifest"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "position.owner",
                "account": "position"
              },
              {
                "kind": "account",
                "path": "position.id",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "manifest"
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "ownerCash",
          "writable": true
        },
        {
          "name": "cash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "position"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "sharesMint"
        },
        {
          "name": "shares",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "position"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "sharesMint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "treasury",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "withdrawAccounts",
          "type": "u16"
        },
        {
          "name": "minRedeemed",
          "type": "u64"
        },
        {
          "name": "minShares",
          "type": "u64"
        }
      ]
    },
    {
      "name": "yieldBatch",
      "discriminator": [
        59,
        151,
        207,
        201,
        169,
        134,
        170,
        115
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "position",
            "manifest"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "position.owner",
                "account": "position"
              },
              {
                "kind": "account",
                "path": "position.id",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "manifest"
        },
        {
          "name": "batch",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  116,
                  99,
                  104
                ]
              },
              {
                "kind": "account",
                "path": "payer"
              },
              {
                "kind": "arg",
                "path": "id"
              }
            ]
          }
        },
        {
          "name": "usdc",
          "address": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        },
        {
          "name": "positionCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "position"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "batchCash",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "batch"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "usdc"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associatedTokenProgram",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "id",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "luckyPool",
      "discriminator": [
        146,
        24,
        131,
        82,
        209,
        113,
        47,
        55
      ]
    },
    {
      "name": "manifest",
      "discriminator": [
        139,
        55,
        191,
        180,
        10,
        101,
        100,
        40
      ]
    },
    {
      "name": "networkState",
      "discriminator": [
        212,
        237,
        148,
        56,
        97,
        245,
        51,
        169
      ]
    },
    {
      "name": "pack",
      "discriminator": [
        244,
        192,
        97,
        212,
        134,
        91,
        198,
        200
      ]
    },
    {
      "name": "packBatch",
      "discriminator": [
        66,
        204,
        58,
        175,
        184,
        42,
        147,
        254
      ]
    },
    {
      "name": "packExecution",
      "discriminator": [
        95,
        157,
        31,
        179,
        39,
        51,
        53,
        50
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    }
  ],
  "events": [
    {
      "name": "activity",
      "discriminator": [
        89,
        164,
        105,
        7,
        102,
        24,
        171,
        187
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "math",
      "msg": "Arithmetic overflow or invalid amount"
    },
    {
      "code": 6001,
      "name": "unauthorized",
      "msg": "Unauthorized authority or account"
    },
    {
      "code": 6002,
      "name": "paused",
      "msg": "New deposits and purchases are paused"
    },
    {
      "code": 6003,
      "name": "manifest",
      "msg": "Invalid immutable stock manifest"
    },
    {
      "code": 6004,
      "name": "mint",
      "msg": "Unsupported stock mint or token program"
    },
    {
      "code": 6005,
      "name": "vault",
      "msg": "Incorrect USDC or vault accounts"
    },
    {
      "code": 6006,
      "name": "state",
      "msg": "Position or pack state does not allow this action"
    },
    {
      "code": 6007,
      "name": "balance",
      "msg": "Insufficient available principal or yield"
    },
    {
      "code": 6008,
      "name": "expired",
      "msg": "Deadline has passed"
    },
    {
      "code": 6009,
      "name": "notExpired",
      "msg": "Refund is not yet available"
    },
    {
      "code": 6010,
      "name": "randomnessPending",
      "msg": "Verifiable randomness is not fulfilled"
    },
    {
      "code": 6011,
      "name": "randomness",
      "msg": "Invalid randomness request or client"
    },
    {
      "code": 6012,
      "name": "delivery",
      "msg": "Insufficient stock delivered after transfer fees"
    },
    {
      "code": 6013,
      "name": "oracle",
      "msg": "Invalid, stale, uncertain, or unverified oracle price"
    },
    {
      "code": 6014,
      "name": "notTriggered",
      "msg": "Order price or schedule is not triggered"
    },
    {
      "code": 6015,
      "name": "config",
      "msg": "Unsafe configuration"
    },
    {
      "code": 6016,
      "name": "principalProtection",
      "msg": "Vault fees or rounding would consume protected principal"
    },
    {
      "code": 6017,
      "name": "message",
      "msg": "Message exceeds 280 characters or 1024 UTF-8 bytes"
    },
    {
      "code": 6018,
      "name": "cpi",
      "msg": "Only top-level user calls are allowed for this instruction"
    }
  ],
  "types": [
    {
      "name": "activity",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "account",
            "type": "pubkey"
          },
          {
            "name": "action",
            "type": "u8"
          },
          {
            "name": "usdc",
            "type": "u64"
          },
          {
            "name": "units",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "pendingAdmin",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "sharesMint",
            "type": "pubkey"
          },
          {
            "name": "activeManifest",
            "type": "pubkey"
          },
          {
            "name": "usdcFeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "yieldShareBps",
            "type": "u16"
          },
          {
            "name": "packFeeBps",
            "type": "u16"
          },
          {
            "name": "tradeFeeBps",
            "type": "u16"
          },
          {
            "name": "maxSlippageBps",
            "type": "u16"
          },
          {
            "name": "maxConfidenceBps",
            "type": "u16"
          },
          {
            "name": "oracleMaxAge",
            "type": "u32"
          },
          {
            "name": "packTimeout",
            "type": "u32"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "enabledProducts",
            "type": "u8"
          },
          {
            "name": "pilotOwner",
            "type": "pubkey"
          },
          {
            "name": "admissionLimit",
            "type": "u64"
          },
          {
            "name": "admittedUsdc",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "configTerms",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "usdcFeed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "yieldShareBps",
            "type": "u16"
          },
          {
            "name": "packFeeBps",
            "type": "u16"
          },
          {
            "name": "tradeFeeBps",
            "type": "u16"
          },
          {
            "name": "maxSlippageBps",
            "type": "u16"
          },
          {
            "name": "maxConfidenceBps",
            "type": "u16"
          },
          {
            "name": "oracleMaxAge",
            "type": "u32"
          },
          {
            "name": "packTimeout",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "destination",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "packs"
          },
          {
            "name": "stocks"
          }
        ]
      }
    },
    {
      "name": "luckyPool",
      "docs": [
        "Only unallocated house capital lives here. Every accepted roll moves its",
        "entire maximum liability into the pack ATA, beyond admin withdrawal authority."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "maxStake",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "manifest",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "sealed",
            "type": "bool"
          },
          {
            "name": "version",
            "type": "u64"
          },
          {
            "name": "stocks",
            "type": {
              "vec": {
                "defined": {
                  "name": "stockSpec"
                }
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "networkConfiguration",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "type": "pubkey"
          },
          {
            "name": "requestFee",
            "type": "u64"
          },
          {
            "name": "fulfillmentAuthorities",
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "tokenFeeConfig",
            "type": {
              "option": {
                "defined": {
                  "name": "oraoTokenFeeConfig"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "networkState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": {
              "defined": {
                "name": "networkConfiguration"
              }
            }
          },
          {
            "name": "numReceived",
            "docs": [
              "Total number of received requests."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "oraoTokenFeeConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "docs": [
              "ORAO token mint address."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "docs": [
              "ORAO token treasury account."
            ],
            "type": "pubkey"
          },
          {
            "name": "fee",
            "docs": [
              "Fee in ORAO SPL token smallest units."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "pack",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "batch",
            "type": "pubkey"
          },
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "manifest",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u64"
          },
          {
            "name": "force",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "unitFee",
            "type": "u64"
          },
          {
            "name": "slippageBps",
            "type": "u16"
          },
          {
            "name": "stockIndex",
            "type": "u16"
          },
          {
            "name": "source",
            "type": {
              "defined": {
                "name": "packSource"
              }
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "packStatus"
              }
            }
          },
          {
            "name": "unitsReceived",
            "type": "u64"
          },
          {
            "name": "uiMultiplierBits",
            "type": "u64"
          },
          {
            "name": "stockValue",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "settledAt",
            "type": "i64"
          },
          {
            "name": "lucky",
            "type": "bool"
          },
          {
            "name": "round",
            "type": "u8"
          },
          {
            "name": "stake",
            "type": "u64"
          },
          {
            "name": "budget",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "packBatch",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "manifest",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "remaining",
            "type": "u64"
          },
          {
            "name": "nextOpen",
            "type": "u64"
          },
          {
            "name": "unitFee",
            "type": "u64"
          },
          {
            "name": "slippageBps",
            "type": "u16"
          },
          {
            "name": "source",
            "type": {
              "defined": {
                "name": "packSource"
              }
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "sender",
            "type": "pubkey"
          },
          {
            "name": "message",
            "type": "string"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "packExecution",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "enabled",
            "type": "bool"
          },
          {
            "name": "maxBudget",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "packSource",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "purchased"
          },
          {
            "name": "earned"
          }
        ]
      }
    },
    {
      "name": "packStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pending"
          },
          {
            "name": "selected"
          },
          {
            "name": "settled"
          },
          {
            "name": "refunded"
          },
          {
            "name": "luckyReady"
          }
        ]
      }
    },
    {
      "name": "position",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "manifest",
            "type": "pubkey"
          },
          {
            "name": "id",
            "type": "u64"
          },
          {
            "name": "principalBasis",
            "type": "u64"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "investedFeeBasis",
            "type": "u64"
          },
          {
            "name": "pendingFees",
            "type": "u64"
          },
          {
            "name": "claimable",
            "type": "u64"
          },
          {
            "name": "grossYield",
            "type": "u64"
          },
          {
            "name": "yieldFees",
            "type": "u64"
          },
          {
            "name": "allocatedYield",
            "type": "u64"
          },
          {
            "name": "stockUnitsReceived",
            "type": "u64"
          },
          {
            "name": "stockUsdcSpent",
            "type": "u64"
          },
          {
            "name": "stockIndex",
            "type": "u16"
          },
          {
            "name": "yieldShareBps",
            "type": "u16"
          },
          {
            "name": "tradeFeeBps",
            "type": "u16"
          },
          {
            "name": "feeCarry",
            "type": "u16"
          },
          {
            "name": "slippageBps",
            "type": "u16"
          },
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "positionKind"
              }
            }
          },
          {
            "name": "destination",
            "type": {
              "defined": {
                "name": "destination"
              }
            }
          },
          {
            "name": "autoPacks",
            "type": "bool"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "positionStatus"
              }
            }
          },
          {
            "name": "targetPrice",
            "type": "u64"
          },
          {
            "name": "stepsRemaining",
            "type": "u16"
          },
          {
            "name": "intervalSeconds",
            "type": "u32"
          },
          {
            "name": "nextFillAt",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "positionKind",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "earn"
          },
          {
            "name": "limit"
          },
          {
            "name": "dca"
          }
        ]
      }
    },
    {
      "name": "positionStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "filled"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "positionSwapTerms",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "input",
            "type": "u64"
          },
          {
            "name": "quotedOutput",
            "type": "u64"
          },
          {
            "name": "minimumOutput",
            "type": "u64"
          },
          {
            "name": "quotedAt",
            "type": "i64"
          },
          {
            "name": "withdrawAccounts",
            "type": "u16"
          },
          {
            "name": "depositAccounts",
            "type": "u16"
          },
          {
            "name": "minimumRedeemed",
            "type": "u64"
          },
          {
            "name": "minimumShares",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "positionTerms",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "type": {
              "defined": {
                "name": "positionKind"
              }
            }
          },
          {
            "name": "destination",
            "type": {
              "defined": {
                "name": "destination"
              }
            }
          },
          {
            "name": "autoPacks",
            "type": "bool"
          },
          {
            "name": "stockIndex",
            "type": "u16"
          },
          {
            "name": "targetPrice",
            "type": "u64"
          },
          {
            "name": "steps",
            "type": "u16"
          },
          {
            "name": "intervalSeconds",
            "type": "u32"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "slippageBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "stockSpec",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "type": "pubkey"
          },
          {
            "name": "feed",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "ratioNumerator",
            "type": "u64"
          },
          {
            "name": "ratioDenominator",
            "type": "u64"
          },
          {
            "name": "decimals",
            "type": "u8"
          },
          {
            "name": "packEligible",
            "type": "bool"
          }
        ]
      }
    }
  ]
};
