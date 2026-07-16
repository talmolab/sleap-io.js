/**
 * A per-detection re-ID appearance embedding (SLP 2.5+).
 *
 * Mirrors Python `sleap_io.model.embedding.Embedding`: a 1-D feature vector produced
 * by a re-identification / appearance model, attached to a detection alongside its
 * {@link Identity} assignment. Stored on disk in the `/embeddings` group as an
 * `(N, D)` float matrix joined to detections by `(owner_type, owner_id)`.
 */
export class Embedding {
  /** The 1-D feature vector. */
  vector: number[];

  constructor(vector: ArrayLike<number>) {
    this.vector = Array.from(vector, Number);
  }

  /** Dimensionality `D` of the vector. */
  get dim(): number {
    return this.vector.length;
  }
}
