export default defineEventHandler(() => {
  const config = useRuntimeConfig()
  return {
    name: config.public.appName,
    version: config.public.appVersion,
  }
})
