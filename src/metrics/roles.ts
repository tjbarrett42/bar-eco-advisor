// Classifies a unit (joined as alias `sd` from static_defs) into an eco/army axis role.
// Priority: eco producers > build power > immobile defense > mobile army.
export const ROLE_CASE = `CASE
  WHEN sd.extractsMetal > 0 OR sd.metalMake > 0 OR sd.energyMake > 0 THEN 'eco'
  WHEN sd.buildPower > 0 THEN 'bp'
  WHEN sd.isImmobile = 1 THEN 'defense'
  ELSE 'army'
END`;
