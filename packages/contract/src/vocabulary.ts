/**
 * Declares the runtime list of a closed vocabulary whose type is generated from
 * contract/api/openapi.yaml (ADR 0006). The list must name every member of `T`
 * and nothing else, or the call fails to compile, so the list and the generated
 * type cannot drift apart. It returns `values` unchanged.
 *
 * ```ts
 * export const NOTIFICATION_MODES = vocabulary<NotificationMode>()(['alert', 'silent', 'off']);
 * ```
 */
export function vocabulary<T extends string>() {
  return <const V extends readonly T[]>(
    values: V &
      ([Exclude<T, V[number]>] extends [never]
        ? unknown
        : { readonly missingVocabularyMembers: Exclude<T, V[number]> })
  ): V => values;
}
