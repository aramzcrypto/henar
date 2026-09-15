/** Local CLI wrapper; the implementation lives in apps/router (uploaded to Vercel). */
import { verifyMintsCli } from "../../apps/router/src/verify-mints-cli";

verifyMintsCli().catch((e) => {
  process.stderr.write(`${e}\n`);
  process.exitCode = 1;
});
