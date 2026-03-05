import { Labels } from "./labels.js";

export class LabelsSet {
  labels: Map<string, Labels>;

  constructor(entries?: Record<string, Labels>) {
    this.labels = new Map(Object.entries(entries ?? {}));
  }

  get size(): number {
    return this.labels.size;
  }

  get(key: string): Labels | undefined {
    return this.labels.get(key);
  }

  set(key: string, value: Labels): void {
    this.labels.set(key, value);
  }

  delete(key: string): void {
    this.labels.delete(key);
  }

  keys(): IterableIterator<string> {
    return this.labels.keys();
  }

  values(): IterableIterator<Labels> {
    return this.labels.values();
  }

  entries(): IterableIterator<[string, Labels]> {
    return this.labels.entries();
  }

  [Symbol.iterator](): IterableIterator<[string, Labels]> {
    return this.labels.entries();
  }

  static fromLabelsList(labelsList: Labels[], keys?: string[]): LabelsSet {
    const set = new LabelsSet();
    for (let i = 0; i < labelsList.length; i++) {
      const key = keys?.[i] ?? `labels_${i}`;
      set.set(key, labelsList[i]);
    }
    return set;
  }

  toArray(): Labels[] {
    return Array.from(this.labels.values());
  }

  keyArray(): string[] {
    return Array.from(this.labels.keys());
  }
}
