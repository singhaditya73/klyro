import { z } from 'zod'

/**
 * The provider fields a settings patch may carry.
 *
 * `fastModel` and `transcribeModel` were missing when this schema was written
 * inline in the IPC layer, and zod drops unknown keys: the overlay's model
 * choice (and the control panel's fast model) looked saved, showed in the UI,
 * and never reached the settings file. Keeping the schema in one place with a
 * test is the guard against that happening again.
 */
export const providerSettingsPatchSchema = z.object({
  baseUrl: z.string().max(500),
  model: z.string().max(200),
  fastModel: z.string().max(200).optional(),
  transcribeModel: z.string().max(200).optional()
})

/** Every provider in a patch is a full provider object, as the UI sends it. */
export const providersPatchSchema = z.record(z.string(), providerSettingsPatchSchema)
