import { readWalletBlock } from './wallet-snapshot.js';

export async function updateWalletAllowance({ provider, token, account, splitAddress, requested, afterBlock, submit, onReset }) {
  async function read(afterBlock) {
    const block = await readWalletBlock(provider, afterBlock);
    const allowance = await token.allowance(account, splitAddress, { blockTag: block.number });
    return { allowance, blockNumber: Number(block.number) };
  }

  async function write(amount) {
    const receipt = await submit(amount);
    if (receipt?.status !== 1 || !Number.isSafeInteger(receipt.blockNumber)) {
      throw new Error('The allowance transaction did not return a successful receipt.');
    }
    return receipt;
  }

  const current = await read(afterBlock);
  if (current.allowance === requested) return { ...current, receipt: null };
  if (current.allowance > 0n && requested > 0n) {
    onReset();
    const reset = await write(0n);
    if ((await read(reset.blockNumber)).allowance !== 0n) {
      throw new Error('The current allowance is still nonzero. Check it before approving a replacement.');
    }
  }

  const receipt = await write(requested);
  return { ...await read(receipt.blockNumber), receipt };
}
