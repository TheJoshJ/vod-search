import { env, pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers"

const queryInstruction = "Represent this sentence for searching relevant passages: "

export class BgeEmbedder {
  private extractor: FeatureExtractionPipeline | null = null

  constructor(private readonly modelPath: string) {}

  async start(): Promise<void> {
    if (this.extractor) return
    env.allowRemoteModels = false
    this.extractor = await pipeline("feature-extraction", this.modelPath, {
      local_files_only: true,
      device: "cpu",
      dtype: "fp32"
    })
  }

  async embedPassages(texts: string[]): Promise<Float32Array[]> {
    return this.embed(texts)
  }

  async embedQuery(text: string): Promise<Float32Array> {
    return (await this.embed([`${queryInstruction}${text}`]))[0]!
  }

  async close(): Promise<void> {
    await this.extractor?.dispose()
    this.extractor = null
  }

  private async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []
    await this.start()
    const output = await this.extractor!(texts, { pooling: "mean", normalize: true })
    if (output.dims.length !== 2 || output.dims[1] !== 384) {
      throw new Error(`Expected 384-dimensional BGE embeddings, received [${output.dims.join(", ")}]`)
    }
    const values = output.data
    if (!(values instanceof Float32Array)) throw new Error(`Expected float32 embeddings, received ${output.type}`)
    return Array.from({ length: texts.length }, (_, index) =>
      values.slice(index * 384, (index + 1) * 384))
  }
}

