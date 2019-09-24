---
marp: true
---

# Bitcoin Cashで書くちょっとスマートなコントラクト

### haryu703

---
# 自己紹介
[haryu703](https://twitter.com/haryu703)

最近の興味
- Bitcoin Cash
- Rust
- クラウド開発環境

---
# Bitcoin Cash
- 2017/8/1 に Bitcoin Core からハードフォークしたチェーン
- トランザクション手数料が非常に安い
  - 1sat/byte (1送金あたり0.1円以下)
- 0-conf での安全な取引に注力している
  - Replace by fee 機能の削除
  - (検討中) Avalanche, Delta block など

---
# Bitcoin Script
- Bitcoin のトランザクションをロック・アンロックするスクリプトのこと
- **ループを表現できない**

例) P2PKH のスクリプトは以下のように記述する
- scriptPubKey (Locking Script)
```
OP_DUP OP_HASH160 <pubkey-hash> OP_EQUALVERIFY OP_CHECKSIG
```
- scriptSig (Unlocking Script)
```
<signature> <pubkey>
```

---
# Spedn

- Bitcoin Cash 上で動くコントラクトを記述するための言語
- Bitcoin Script にコンパイルされる

---
# その他の言語

![w:900](https://news.bitcoin.com/wp-content/uploads/2019/05/2019-05-29-10-33-34.jpg)
https://news.bitcoin.com/cashscript-is-coming-bringing-ethereum-like-smart-contracts-to-bitcoin-cash/

Bitcoin Core では Miniscript などが開発されている

---
# Spedn の使い方
## Contract の記述
P2PKH を Spedn で記述すると下記のようになる ([全体](https://github.com/haryu703/ccstudy-33/blob/master/examples/p2pkh/p2pkh.spedn))
```c
/**
 * @param {Ripemd160} pubKeyHash - pubkey-hash
 */
contract PayToPublicKeyHash(Ripemd160 pubKeyHash) {
  /**
   * @param {PubKey} pubKey - pubkey
   * @param {Sig} sig - signature
   */
  challenge spend(PubKey pubKey, Sig sig) {
    // OP_HASH160 <pubkey-hash> OP_EQUALVERIFY
    verify hash160(pubKey) == pubKeyHash;
    // OP_CHECKSIG
    verify checkSig(sig, pubKey);
  }
}
```

---
## Spedn のコンパイル
Spedn は ASM 形式か Hex 形式でコンパイルすることができる

- ASM 形式
```bash
$ spedn compile -c p2pkh.spedn
<pubKeyHash> 2 PICK HASH160 OVER EQUALVERIFY OVER 3 PICK CHECKSIG NIP NIP NIP
```
- Hex 形式
Hex 形式の場合は Contract に必要なパラメータを全て指定する必要がある
```bash
$ spedn compile -h -c examples/p2pkh/p2pkh.spedn -- pubKeyHash=0xce763f54392333b23fc473dd9bd7f05ca9ec636a
14ce763f54392333b23fc473dd9bd7f05ca9ec636a5279a97888785379ac777777
```

---
# コンパイル結果を読んでみる
- `<n> OP_PICK` はスタックの上から n+1 個目のアイテムをコピーする
- `OP_OVER` はスタックの上から2個目のアイテムをコピーする
- `OP_NIP` はスタックの上から2個目のアイテムを削除する
- 右側のコメントは、左側のスクリプト実行後のスタック
```
<pubKeyHash>  // <pubKeyHash> <sig> <pubKey>
2 PICK        // <pubKey> <pubKeyHash> <sig> <pubKey>
HASH160       // <pubKeyHash> <pubKeyHash> <sig> <pubKey>
OVER          // <pubKeyHash> <pubKeyHash> <pubKeyHash> <sig> <pubKey>
EQUALVERIFY   // <pubKeyHash> <sig> <pubKey>
OVER          // <sig> <pubKeyHash> <sig> <pubKey>
3 PICK        // <pubKey> <sig> <pubKeyHash> <sig> <pubKey>
CHECKSIG      // OP_TRUE <pubKeyHash> <sig> <pubKey>
NIP NIP NIP   // OP_TRUE
```

---
# Node.js から使う
Spedn は Node.js 向けの SDK から読み込んで使うことができる

## 1/3 ([全体](https://github.com/haryu703/ccstudy-33/blob/master/examples/p2pkh/index.ts))
```ts
  // 秘密鍵から今回使うパラメータを計算する
  const alice = bitbox.ECPair.fromWIF(wif);
  const alicePk = bitbox.ECPair.toPublicKey(alice);
  const alicePkh = bitbox.Crypto.hash160(alicePk);

  // Spedn ファイルから Contract を作成する
  const compiler = new Spedn();
  const P2PKH = await compiler.compileFile(path.join(__dirname, "p2pkh.spedn"));
```

---
## 2/3 ([全体](https://github.com/haryu703/ccstudy-33/blob/master/examples/p2pkh/index.ts))
```ts
  // 必要なパラメータを渡して Contract をインスタンス化する
  const instance = new P2PKH({ pubKeyHash: alicePkh });
  console.log(instance.getAddress("testnet"));

  // アンロックする UTXO 情報を取得する
  const coins = await instance.findCoins("testnet");
  console.log(coins);
```

---
## 3/3 ([全体](https://github.com/haryu703/ccstudy-33/blob/master/examples/p2pkh/index.ts))
```ts
  // トランザクションを作成してブロードキャストする
  const txid = await new TxBuilder("testnet")
    // アンロックする UTXO を渡し、署名する
    .from(coins, (input, context) => {
      // Spedn ファイルに定義した challenge から `spend()` を使ってアンロックする
      return input.spend({
        pubKey: alicePk,
        sig: context.sign(alice, SigHash.SIGHASH_ALL)
      });
    })
    // 送金先を指定する
    .to(instance.getAddress("testnet"))
    // トランザクションをブロードキャストする
    .broadcast();
  console.log(txid);
```

---
# 応用
## OP_CHECKDATASIG(VERIFY) (OP_CDS, OP_DSV)
使い方: `<sig> <msg> <pubKey> OP_CHECKDATASIG(VERIFY)`
- 2018/11/15 のハードフォークで追加された OP_CODE
- 任意のデータに対する署名を検証する
- シンプルな例では、中央集権的オラクル（レフリーとも）に使える

---
# Bitcoin Covenants
この資料の中では、送金先アドレスを強制する Bitcoin Script を指す
送金先に送金元アドレスを指定することで、トランザクションの**ループが可能になる**
## 仕組み
Bitcoin Script の中で2つの署名検証を行う
- `<sig> <pubKey> CHECKSIG`
- `<sig> <sha256(txdata)> <pubKey> CHECKDATASIG`

2つの署名検証に成功するならば `<txdata>` は署名前のトランザクションと同じ
=> `<txdata>` に含まれる送金先情報を利用できる

---
# Mecenas
Covenants を利用したコントラクトの一つ

コントラクト作成時に以下の引き出し条件に関するパラメータを決める
- 一度に引き出せる金額
- 引き出せる間隔
- 引き出し先アドレス

---
# Mecenas の実装
## Contract ([全体](https://github.com/haryu703/ccstudy-33/blob/master/examples/mecenas/mecenas.spedn))
```c
/**
 * @param {Ripemd160} pkh - `protege()` 用の引き出し先アドレス
 * @param {Ripemd160} pkh2 - `mecenas()` 用の引き出し先アドレス
 * @param {int} pledge - `protege()` で一度に引き出せる金額
 * @param {TimeSpan} period - 引き出し間隔
 */
contract Mecenas(Ripemd160 pkh, Ripemd160 pkh2, int pledge, TimeSpan period) {
...
```

---
## 引き出しの challenge ([全体](https://github.com/haryu703/ccstudy-33/blob/master/examples/mecenas/mecenas.spedn))
```c
  /**
   * @param {PubKey} pk - 署名した秘密鍵に対応する公開鍵
   * @param {Sig} sig - トランザクション全体の署名
   * @param {bin} preimage - 署名前のシリアライズされたトランザクション
   */
  challenge protege(PubKey pk, Sig sig, bin preimage) {
  ...
```

---
## トランザクションのデシリアライズ ([全体](https://github.com/haryu703/ccstudy-33/blob/master/examples/mecenas/mecenas.spedn))
```c
    ...
    // preimage deserializaion
    bin [ver, _] = preimage @ 4; // nVersion
    bin [_, tail] = preimage @ (size(preimage) - 40); // hashOutput + nLocktime + sighash
    bin [hashOutput, _] = tail @ 32;
    bin [torso, _] =  preimage @ (size(preimage) - 44);
    bin [_, belly] = torso @ 104;
    bin [scriptCode, value] = belly @ (size(belly) - 8);
    ...
```

---
## トランザクションの検証 ([全体](https://github.com/haryu703/ccstudy-33/blob/master/examples/mecenas/mecenas.spedn))
```c
    ...
    // トランザクションの検証
    verify checkSig(sig, pk);
    // preimage の検証
    verify checkDataSig(toDataSig(sig), sha256(preimage), pk);
    // 上記2つの検証で preimage は実際のトランザクションと一致することが保証された
    ...
    verify checkSequence(period);
    verify bin2num(ver) >= 2;
    ...
```

---
## 送金額の計算 ([全体](https://github.com/haryu703/ccstudy-33/blob/master/examples/mecenas/mecenas.spedn))
```c
    int fee = 1000;
    bin amount2 = num2bin(pledge, 8);
    bin amount1 = num2bin(bin2num(value) - pledge - fee, 8);
```
## 送金先の検証 ([全体](https://github.com/haryu703/ccstudy-33/blob/master/examples/mecenas/mecenas.spedn))
```c
    bin out1 = amount1  . newVarInt1 . opHash160 . pushHash . hash160(rawscr) . opEqual ;
    bin out2 = amount2  . newVarInt2 . opDup . opHash160 . pushHash . pkh . opEqualverify . opChecksig;
    verify hash256(out1 . out2) == Sha256(hashOutput);
```

---
# コンパイル後のスクリプト
```txt
<pkh> <pkh2> <pledge> <period> 4 PICK TRUE EQUAL IF 5 PICK 4 SPLIT DROP 6 PICK DUP SIZE NIP PUSH(1)[40] SUB 
SPLIT NIP DUP PUSH(1)[32] SPLIT DROP 8 PICK DUP SIZE NIP PUSH(1)[44] SUB SPLIT DROP DUP PUSH(1)[104] SPLIT
NIP DUP OVER SIZE NIP 8 SUB SPLIT 13 PICK 15 PICK CHECKSIGVERIFY 13 PICK SIZE 1SUB SPLIT DROP 13 PICK 
SHA256 16 PICK CHECKDATASIGVERIFY PUSH(2)[232,3] 9 PICK 8 NUM2BIN 2 PICK BIN2NUM 11 PICK SUB 2 PICK 
SUB 8 NUM2BIN PUSH(1)[118] PUSH(1)[135] PUSH(1)[169] PUSH(1)[20] PUSH(1)[23] PUSH(1)[25] PUSH(1)[136] 
PUSH(1)[172] 12 PICK 3 SPLIT NIP PUSH(1)[19] PICK CHECKSEQUENCEVERIFY DROP PUSH(1)[18] PICK BIN2NUM 
2 GREATERTHANOREQUAL VERIFY 9 PICK 5 PICK CAT 7 PICK CAT 6 PICK CAT OVER HASH160 CAT 8 PICK CAT 11 PICK 
5 PICK CAT 10 PICK CAT 8 PICK CAT 7 PICK CAT PUSH(1)[24] PICK CAT 4 PICK CAT 3 PICK CAT 2DUP CAT HASH256 PUSH(1)[19] PICK EQUAL 
NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP NIP 
ELSE 4 PICK 2 EQUAL IF 6 PICK HASH160 3 PICK EQUALVERIFY 5 PICK 7 PICK CHECKSIG NIP NIP NIP NIP NIP NIP NIP ELSE FALSE ENDIF ENDIF
```
- 最適化支援ツールの [Cashproof](https://github.com/EyeOfPython/cashproof) が開発中
- 困ったら Bitcoin Script をステップ実行できる [meep](https://github.com/gcash/meep) でデバッグ

---
# まとめ
- Spedn を使うと Bitcoin Script を簡単に書くことができる
- OP_CHECKDATASIG はループするトランザクションを可能にする

## 資料とサンプルコード
https://github.com/haryu703/ccstudy-33

---
# 参考資料など
- Spedn
https://bitbucket.org/o-studio/spedn/src/master/
- OP_CHECKDATASIG
https://github.com/bitcoincashorg/bitcoincash.org/blob/master/spec/op_checkdatasig.md 
- Bitcoin Covenants
https://fc16.ifca.ai/bitcoin/papers/MES16.pdf
- Mecenas
https://www.reddit.com/r/btc/comments/cuzi1o/mecenas_recurring_payment_smart_contract_since_we/
- Digenst algorithm
https://www.bitcoincash.org/spec/replay-protected-sighash.html#specification
