import { OpenWriteGenerationPrototype } from "@/components/prototype/openwrite-generation-prototype";

/**
 * PROTOTYPE ONLY — three generation-feedback layouts, switchable via ?variant=A|B|C.
 * This route exists to answer whether OpenWrite's observable generation workflow
 * feels clearer than the current chat/workbench experience.
 */
export default function OpenWriteGenerationPrototypePage() {
  return <OpenWriteGenerationPrototype />;
}
