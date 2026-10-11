import { installUpdate } from "./update-helper";

try {
  installUpdate(process.argv[2], process.env.TANTALUS_UPDATE_PACKAGE, process.env.TANTALUS_UPDATE_SIGNATURE);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
