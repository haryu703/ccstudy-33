import path from "path";
import { BITBOX } from "bitbox-sdk";
import { Spedn, TxBuilder, SigHash } from "spedn";

async function main() {
  // Bitcoin Cash 用 SDK の初期化
  const bitbox = new BITBOX({ restURL: "https://trest.bitcoin.com/v2/" });

  // 秘密鍵
  const wif =
    process.env.CASHSCRIPT_WIF ||
    "cNTTVyQEkh1ZXnWsB7XhHGfGHQjTxHDqTPBsAzeDQ2aE7tHArcys";

  // 秘密鍵から今回使うパラメータを計算する
  const alice = bitbox.ECPair.fromWIF(wif);
  const alicePk = bitbox.ECPair.toPublicKey(alice);
  const alicePkh = bitbox.Crypto.hash160(alicePk);

  // Spedn ファイルから Contract を作成する
  const compiler = new Spedn();
  const P2PKH = await compiler.compileFile(path.join(__dirname, "p2pkh.spedn"));
  // compiler を破棄する
  compiler.dispose();

  // 必要なパラメータを渡して Contract をインスタンス化する
  const instance = new P2PKH({ pubKeyHash: alicePkh });
  console.log(instance.getAddress("testnet"));

  // アンロックする UTXO 情報を取得する
  const coins = await instance.findCoins("testnet");
  console.log(coins);
  if (!coins.length) {
    console.log("no coins");
    return;
  }

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
}
main().catch(console.error);
