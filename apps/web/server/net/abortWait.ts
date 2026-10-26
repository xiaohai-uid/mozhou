/** 请求范围的可中止等待；只结束调用方等待，不声称取消了操作系统的 DNS 查询。 */
export function abortReason(signal?: AbortSignal): Error {
  const reason: unknown = signal?.reason
  if (reason instanceof Error) return reason
  const error = new Error('This operation was aborted')
  error.name = 'AbortError'
  return error
}

export function withAbort<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted === true) return Promise.reject(abortReason(signal))
  if (signal === undefined) return run()
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { cleanup(); reject(abortReason(signal)) }
    const cleanup = (): void => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      run().then(
        (value) => { cleanup(); resolve(value) },
        (error: unknown) => { cleanup(); reject(error instanceof Error ? error : new Error(String(error))) },
      )
    } catch (error) {
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
