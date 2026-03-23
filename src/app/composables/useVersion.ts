export function useVersion() {
  const config = useRuntimeConfig()
  return {
    version: config.public.appVersion as string,
  }
}
