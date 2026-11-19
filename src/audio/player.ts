/** Plays mono float32 samples. Resolves when playback ends. `tap` also receives the signal (for the visualizer). */
export async function play(ctx: AudioContext, samples: Float32Array, tap?: AudioNode): Promise<void> {
  await ctx.resume();
  const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
  buffer.getChannelData(0).set(samples);
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.connect(ctx.destination);
  if (tap) node.connect(tap);
  await new Promise<void>((resolve) => {
    node.onended = () => {
      node.disconnect();
      resolve();
    };
    node.start();
  });
}
