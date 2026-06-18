/**
 * Global gate for decorative BeakerBot pop-up animations.
 *
 * Set to `true` to restore all gated pop-ups. No other change needed --
 * every gated site imports and checks this constant directly.
 *
 * The following surfaces deliberately IGNORE this gate and always render:
 *   - /showcase (src/app/showcase/page.tsx)
 *   - Dev gallery (src/app/dev/beakerbot-gallery/page.tsx)
 *   - Settings animation picker preview (src/app/settings/page.tsx)
 *
 * Scenes gated by this flag:
 *   - IdleAnimationManager (idle BeakerBot scenes after inactivity)
 *   - ProgressEntertainer (BeakerBot scenes during long async operations)
 *   - TimerAlarm BeakerBotEurekaScene (decorative scene; alarm dialog + sound kept)
 *   - DynamicAnimation at task/goal completion call sites
 *   - SceneTriggerHost "bugstomp" case (decorative error scene)
 *
 * Scenes NOT gated (milestone/onboarding celebrations):
 *   - CelebrationManager (streak milestones, account anniversaries)
 *   - MilestoneTwirlMount / twirlMilestone (rare checkpoint twirl)
 *   - WhatsNewManager / WhatsNewModal
 *   - Page-boot loader BeakerBot (staged loading screen)
 *   - Static BeakerBot (logo, avatar, mascot)
 */
export const POPUP_ANIMATIONS_ENABLED = false;
