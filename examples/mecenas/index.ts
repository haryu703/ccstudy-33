import path from "path";
import { BITBOX } from "bitbox-sdk";
import { Spedn, TxBuilder, SigHash } from "spedn";

const network = "testnet";
const restURL = "https://trest.bitcoin.com/v2/";

async function main() {
  // Bitcoin Cash 用 SDK の初期化
  const bitbox = new BITBOX({ restURL });

  // 秘密鍵
  // const mecenasWif = process.env.MECENAS_SAMPLE_WIF;
  // const protegeWif = process.env.MECENAS_SAMPLE_WIF;
  const mecenasWif = "cNTTVyQEkh1ZXnWsB7XhHGfGHQjTxHDqTPBsAzeDQ2aE7tHArcys";
  const protegeWif = "cNTTVyQEkh1ZXnWsB7XhHGfGHQjTxHDqTPBsAzeDQ2aE7tHArcys";

  // 秘密鍵から今回使うパラメータを計算する
  const mecenas = bitbox.ECPair.fromWIF(mecenasWif);
  const mecenasPk = bitbox.ECPair.toPublicKey(mecenas);
  const mecenasPkh = bitbox.Crypto.hash160(mecenasPk);

  const protege = bitbox.ECPair.fromWIF(protegeWif);
  const protegePk = bitbox.ECPair.toPublicKey(protege);
  const protegePkh = bitbox.Crypto.hash160(protegePk);

  // Spedn ファイルから Contract を作成する
  const compiler = new Spedn();
  const Mecenas = await compiler.compileFile(
    path.join(__dirname, "mecenas.spedn")
  );
  // compiler を破棄する
  compiler.dispose();

  // 引き出し間隔を512秒にセットする
  const period = 1 | (1 << 22); // 22bit目は locktime type flag (BIP-68)

  // 必要なパラメータを渡して Contract をインスタンス化する
  const instance = new Mecenas({
    pkh: protegePkh,
    pkh2: mecenasPkh,
    pledge: 1000,
    period
  });
  console.log(instance.getAddress(network));

  // アンロックする UTXO 情報を取得する
  const coins = await instance.findCoins(network);
  console.log(coins);
  if (!coins.length) {
    console.log("no coins");
    return;
  }

  const balance = coins.reduce((prev, c) => prev + c.utxo.satoshis, 0);
  console.log(balance);

  const fee = 1000;

  // トランザクションを作成してブロードキャストする
  let actualSigning = false;
  const tx = new TxBuilder(network)
    // アンロックする UTXO を渡し、署名する
    .from(
      coins,
      (input, context) => {
        if (actualSigning === false) {
          actualSigning = true;
          return Buffer.allocUnsafe(0);
        }

        const preimage = context.preimage(SigHash.SIGHASH_ALL);

        actualSigning = false;
        return input.protege({
          pk: protegePk,
          sig: context.sign(protege, SigHash.SIGHASH_ALL),
          preimage
        });
      },
      period
    )
    // 送金先を指定する
    .to(instance.getAddress(network), balance - 1000 - fee)
    .to(bitbox.ECPair.toCashAddress(protege), 1000);

  const rawtx = tx.build(true);
  console.log(rawtx.toHex());

  // トランザクションをブロードキャストする
  const txid = await tx.broadcast(true);

  console.log(txid);
}
main().catch(console.error);
