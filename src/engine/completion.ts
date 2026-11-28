import type { EventRow, Trace } from '../contracts';
import type { CompletionDefinition } from '../v03-contracts';

export function completionActivities(definition: CompletionDefinition): ReadonlySet<string> {
  const labels = definition.completionActivities;
  if (!labels.length || labels.some(label => !label.trim()) || new Set(labels).size !== labels.length) {
    throw new RangeError('Choose one or more distinct, nonblank completion activities.');
  }
  return new Set(labels);
}

export function completionMarker(trace: Trace, activities: ReadonlySet<string> | undefined): EventRow | undefined {
  if (activities) return trace.sequence.find(event => activities.has(event.activity));
}
