export type UpstreamDisposition =
  | "migrate_as_skill"
  | "migrate_as_tool_policy"
  | "replace_with_kith"
  | "defer"
  | "delete";

interface ManifestItem {
  key: string;
  source: string;
  license: string;
  dependencies: readonly string[];
  /** Every exact Recombyn skill key referenced by the upstream SKILL.md (hard or optional). */
  related?: readonly string[];
  /** Prompt-pipeline consumers copied from design_prompt_packs/_index.json. */
  usedBy?: readonly string[];
  disposition: UpstreamDisposition;
  reason: string;
}

const promptRoot = "apps/api/seeds/design_prompt_packs/";
const promptUsedBy: Readonly<Record<string, readonly string[]>> = {
  "agent.persona.auto": ["persona"], "agent.persona.locked": ["persona"],
  "agent.prompt.agent_system": ["decide", "paint"], "agent.prompt.ask_blocked_edit": ["decide"],
  "agent.prompt.ask_canvas_size": ["decide"], "agent.prompt.ask_propose_situation": ["apply"],
  "agent.prompt.ask_system": ["decide", "apply"], "agent.prompt.bg_candidate_hint": ["paint"],
  "agent.prompt.chat_agent_system": ["legacy"], "agent.prompt.chat_fallback": ["decide"],
  "agent.prompt.default_assistant_name": ["decide"], "agent.prompt.focus_empty_frame": ["paint", "decide"],
  "agent.prompt.focus_frame_authority": ["paint", "decide"], "agent.prompt.intent_classify": ["intent"],
  "agent.prompt.lc_tools_overlay": ["decide"], "agent.prompt.need_tools_overlay": ["decide"],
  "agent.prompt.official_agent_system": ["legacy"], "agent.prompt.paint_retry": ["paint"],
  "agent.prompt.paint_system": ["paint"], "agent.prompt.review_system": ["review"],
  "agent.prompt.partial_system": ["orchestrator"], "agent.prompt.pending_skills": ["decide", "resources"],
  "agent.prompt.pending_subagents": ["decide", "resources"], "agent.prompt.pending_tools": ["decide", "resources"],
  "agent.prompt.plan_system": ["legacy"], "agent.prompt.prompt_pack_inject_header": ["resources"],
  "agent.prompt.react_system": ["legacy"], "agent.prompt.recover_edit_retry": ["paint", "resources"],
  "agent.prompt.scene_frames_header": ["paint", "decide"], "agent.prompt.size_auto": ["bootstrap", "decide"],
  "agent.prompt.skill_catalog_empty": ["resources", "decide"], "agent.prompt.skill_catalog_header": ["resources", "decide"],
  "agent.prompt.skill_details_header": ["resources", "decide"], "agent.prompt.skill_details_truncated": ["resources", "decide"],
  "agent.prompt.tool_details_args_line": ["resources", "decide"], "agent.prompt.tool_details_header": ["resources", "decide"],
  "agent.prompt.tool_details_hint_line": ["resources", "decide"], "agent.prompt.tool_details_unknown": ["resources", "decide"],
  "agent.prompt.tools_catalog_empty": ["resources", "decide"], "agent.prompt.tools_catalog_header": ["resources", "decide"],
  "agent.prompt.tools_loaded_fallback": ["resources"], "agent.prompt.tools_registry_empty": ["resources", "decide"],
  "agent.prompt.tools_registry_header": ["resources", "decide"], "agent.prompt.unsafe_ops_ask": ["decide"],
  "precheck.router_system": ["precheck"],
};
const prompt = (key: string, file: string, disposition: UpstreamDisposition, reason: string): ManifestItem => ({
  key, source: `${promptRoot}${file}`, license: "Apache-2.0",
  dependencies: ["Recombyn prompt-pack loader"], usedBy: promptUsedBy[key] ?? [], disposition, reason,
});

/** Exact 45-kind index at Recombyn abd8198. No prompt content is bundled in stage 1. */
export const RECOMBYN_PROMPT_DISPOSITION: readonly ManifestItem[] = [
  prompt("agent.persona.auto", "stages/persona.md", "delete", "Recombyn persona conflicts with Kith agent identity"),
  prompt("agent.persona.locked", "stages/persona.md", "delete", "Recombyn model persona conflicts with Kith model control"),
  prompt("agent.prompt.agent_system", "stages/decide.md", "defer", "Stage 4 capability-scoped system delta only"),
  prompt("agent.prompt.ask_blocked_edit", "stages/apply_ux.md", "delete", "Replace Recombyn Ask flow with Kith turn semantics"),
  prompt("agent.prompt.ask_canvas_size", "stages/apply_ux.md", "delete", "Replace Recombyn Ask flow with Kith skill"),
  prompt("agent.prompt.ask_propose_situation", "stages/apply_ux.md", "delete", "Replace Recombyn Ask copy with Kith UI"),
  prompt("agent.prompt.ask_system", "stages/decide.md", "delete", "No second Ask runtime"),
  prompt("agent.prompt.bg_candidate_hint", "snippets.md", "replace_with_kith", "Core snapshot supplies bounded background candidates"),
  prompt("agent.prompt.chat_agent_system", "stages/legacy.md", "delete", "Kith Harness owns chat"),
  prompt("agent.prompt.chat_fallback", "stages/apply_ux.md", "defer", "Stage 4 honest reply contract"),
  prompt("agent.prompt.default_assistant_name", "snippets.md", "delete", "Kith agent identity is authoritative"),
  prompt("agent.prompt.focus_empty_frame", "snippets.md", "replace_with_kith", "Canvas snapshot/grant provides focus"),
  prompt("agent.prompt.focus_frame_authority", "snippets.md", "replace_with_kith", "Grant provides authoritative frame scope"),
  prompt("agent.prompt.intent_classify", "stages/intent_precheck.md", "migrate_as_tool_policy", "Retain chat/canvas/design intent distinction"),
  prompt("agent.prompt.lc_tools_overlay", "stages/decide.md", "delete", "No LangChain runtime"),
  prompt("agent.prompt.need_tools_overlay", "stages/decide.md", "replace_with_kith", "Gateway capability discovery replaces resource loop"),
  prompt("agent.prompt.official_agent_system", "stages/legacy.md", "delete", "No Recombyn create-agent loop"),
  prompt("agent.prompt.paint_retry", "stages/paint.md", "defer", "Stage 4 conflict/retry skill"),
  prompt("agent.prompt.paint_system", "stages/paint.md", "migrate_as_tool_policy", "Retain placement/id/frame/destructive rules"),
  prompt("agent.prompt.review_system", "stages/review.md", "migrate_as_tool_policy", "Retain review dimensions without swarm"),
  prompt("agent.prompt.partial_system", "stages/legacy.md", "defer", "Stage 4 selection-scoped edit skill"),
  prompt("agent.prompt.pending_skills", "snippets.md", "defer", "Kith skill assembly owns reinjection"),
  prompt("agent.prompt.pending_subagents", "snippets.md", "delete", "No Recombyn subagent orchestration"),
  prompt("agent.prompt.pending_tools", "snippets.md", "replace_with_kith", "Kith Gateway result envelope"),
  prompt("agent.prompt.plan_system", "stages/legacy.md", "delete", "Kith runtime keeps its own planning behavior"),
  prompt("agent.prompt.prompt_pack_inject_header", "snippets.md", "defer", "Stage 4 skill projection wrapper"),
  prompt("agent.prompt.react_system", "stages/decide.md", "delete", "No Recombyn JSON runtime protocol"),
  prompt("agent.prompt.recover_edit_retry", "stages/paint.md", "defer", "Stage 4 operation reconciliation"),
  prompt("agent.prompt.scene_frames_header", "snippets.md", "replace_with_kith", "Snapshot_get returns canonical frame projection"),
  prompt("agent.prompt.size_auto", "stages/paint.md", "replace_with_kith", "Canvas bounds and placement contract"),
  prompt("agent.prompt.skill_catalog_empty", "snippets.md", "replace_with_kith", "Kith skill registry response"),
  prompt("agent.prompt.skill_catalog_header", "snippets.md", "replace_with_kith", "Kith skill registry response"),
  prompt("agent.prompt.skill_details_header", "snippets.md", "replace_with_kith", "Kith skill projection format"),
  prompt("agent.prompt.skill_details_truncated", "snippets.md", "replace_with_kith", "Kith context budget disclosure"),
  prompt("agent.prompt.tool_details_args_line", "snippets.md", "replace_with_kith", "Gateway schemas are authoritative"),
  prompt("agent.prompt.tool_details_header", "snippets.md", "replace_with_kith", "Gateway schemas are authoritative"),
  prompt("agent.prompt.tool_details_hint_line", "snippets.md", "replace_with_kith", "Canvas skill owns usage hints"),
  prompt("agent.prompt.tool_details_unknown", "snippets.md", "replace_with_kith", "Gateway capability.describe handles unknown tools"),
  prompt("agent.prompt.tools_catalog_empty", "snippets.md", "replace_with_kith", "Gateway capability discovery"),
  prompt("agent.prompt.tools_catalog_header", "snippets.md", "replace_with_kith", "Gateway capability discovery"),
  prompt("agent.prompt.tools_loaded_fallback", "snippets.md", "replace_with_kith", "Gateway result envelope"),
  prompt("agent.prompt.tools_registry_empty", "snippets.md", "replace_with_kith", "Gateway capability discovery"),
  prompt("agent.prompt.tools_registry_header", "snippets.md", "replace_with_kith", "Gateway capability discovery"),
  prompt("agent.prompt.unsafe_ops_ask", "stages/apply_ux.md", "migrate_as_tool_policy", "Retain destructive confirmation policy"),
  prompt("precheck.router_system", "stages/intent_precheck.md", "delete", "Kith model/runtime control remains authoritative"),
];

const skillDependencies: Readonly<Record<string, readonly string[]>> = {
  anti_ai_slop: ["tool:update_node", "tool:delete_nodes"],
  color: ["tool:create_shape", "tool:update_node"],
  composition: ["skill:layout", "tool:create_frame", "tool:create_image", "tool:create_text", "tool:create_shape", "tool:update_node"],
  design_brief: [],
  design_review: [],
  design_system: ["skill:typography", "skill:color", "tool:create_text", "tool:create_shape", "tool:update_node"],
  imagery: ["tool:create_image", "tool:create_shape", "tool:create_icon", "tool:update_node"],
  layout: ["tool:create_frame", "tool:move_nodes", "tool:align_nodes", "tool:distribute_nodes", "tool:update_node"],
  polish: ["tool:update_node", "tool:delete_nodes", "tool:move_nodes", "tool:align_nodes"],
  responsive: ["tool:create_frame", "tool:update_node", "tool:move_nodes"],
  typography: ["tool:create_text", "tool:update_node", "tool:outline_text"],
  visual_direction: ["skill:imagery"],
  awesome_design_md: ["tool:create_frame", "tool:create_shape", "tool:create_text", "tool:create_image", "tool:update_node"],
  banner_ad: ["skill:image_gen", "skill:garden_style", "tool:create_frame", "tool:create_image", "tool:create_text", "tool:create_shape", "tool:update_node"],
  brush_ops: ["Paynter brush assets", "durable pencil operations", "tool:create_shape", "tool:update_node", "tool:create_frame"],
  dashboard_ui: ["skill:design_brief", "skill:visual_direction", "skill:design_system", "skill:composition", "skill:anti_ai_slop", "skill:design_review", "skill:polish", "skill:responsive", "tool:create_frame", "tool:create_shape", "tool:create_text", "tool:create_icon", "tool:create_svg", "tool:update_node", "tool:delete_nodes", "tool:move_nodes"],
  ecommerce_surface: ["skill:image_gen", "skill:icon_set", "skill:shadcn_ui", "tool:create_frame", "tool:create_image", "tool:create_text", "tool:create_shape", "tool:update_node"],
  garden_style: ["tool:create_frame", "tool:create_shape", "tool:create_text", "tool:create_image", "tool:create_svg", "tool:update_node"],
  icon_set: ["tool:create_frame", "tool:create_icon", "tool:create_svg", "tool:create_shape", "tool:create_text", "tool:update_node"],
  image_gen: ["skill:design_brief", "skill:visual_direction", "skill:composition", "skill:anti_ai_slop", "tool:create_image", "tool:create_frame", "tool:update_node"],
  landing_page: ["skill:design_brief", "skill:visual_direction", "skill:design_system", "skill:composition", "skill:anti_ai_slop", "skill:design_review", "skill:polish", "skill:responsive", "tool:create_frame", "tool:create_shape", "tool:create_text", "tool:create_image", "tool:update_node", "tool:delete_nodes"],
  long_scroll: ["tool:create_frame", "tool:create_image", "tool:create_text", "tool:create_shape", "tool:update_node"],
  mobile_app_ui: ["tool:create_frame", "tool:create_shape", "tool:create_icon", "tool:create_svg", "tool:create_text", "tool:create_image", "tool:update_node"],
  motion_lottie: ["tool:create_lottie", "tool:update_node", "tool:create_frame"],
  poster_craft: ["skill:design_brief", "skill:visual_direction", "skill:design_system", "skill:composition", "skill:anti_ai_slop", "skill:design_review", "skill:polish", "tool:create_frame", "tool:create_image", "tool:create_text", "tool:create_shape", "tool:update_node", "tool:delete_nodes"],
  resume_layout: ["tool:create_frame", "tool:create_shape", "tool:create_text", "tool:create_image", "tool:update_node", "tool:move_nodes"],
  shadcn_ui: ["tool:create_frame", "tool:create_shape", "tool:create_text", "tool:create_image", "tool:update_node"],
  type_specimen: ["skill:image_gen", "skill:garden_style", "tool:create_frame", "tool:create_text", "tool:create_shape", "tool:update_node"],
};

const skillReferences: Readonly<Record<string, readonly string[]>> = {
  anti_ai_slop: [], color: [], composition: [], design_brief: [], design_review: [],
  design_system: [], imagery: [], layout: [], polish: [], responsive: [], typography: [],
  visual_direction: [], awesome_design_md: ["garden_style", "shadcn_ui"],
  banner_ad: ["garden_style", "image_gen"], brush_ops: ["icon_set", "image_gen", "poster_craft"],
  dashboard_ui: ["icon_set", "image_gen", "mobile_app_ui", "shadcn_ui"],
  ecommerce_surface: ["icon_set", "image_gen", "shadcn_ui"], garden_style: ["awesome_design_md", "image_gen", "landing_page", "poster_craft"],
  icon_set: ["dashboard_ui", "image_gen", "mobile_app_ui", "motion_lottie", "shadcn_ui"],
  image_gen: ["banner_ad", "icon_set", "landing_page", "poster_craft"],
  landing_page: ["icon_set", "image_gen", "shadcn_ui"],
  long_scroll: ["garden_style", "image_gen"], mobile_app_ui: ["icon_set", "image_gen", "motion_lottie", "shadcn_ui"],
  motion_lottie: ["icon_set", "image_gen", "mobile_app_ui", "poster_craft", "shadcn_ui"],
  poster_craft: ["garden_style", "image_gen"],
  resume_layout: ["image_gen", "shadcn_ui"], shadcn_ui: ["awesome_design_md", "dashboard_ui", "landing_page", "mobile_app_ui"],
  type_specimen: ["garden_style", "image_gen"],
};

const skill = (key: string, group: "foundation" | "domains", disposition: UpstreamDisposition, license: string, reason: string): ManifestItem => ({
  key, source: `skills/${group}/${key}/SKILL.md`, license,
  dependencies: skillDependencies[key] ?? [],
  related: skillReferences[key] ?? [],
  disposition, reason,
});

/** Exact 28 skills at Recombyn abd8198. Stage 1 classifies only; none are bundled yet. */
export const RECOMBYN_SKILL_DISPOSITION: readonly ManifestItem[] = [
  skill("anti_ai_slop", "foundation", "migrate_as_skill", "Apache-2.0", "Canvas design quality rule"),
  skill("color", "foundation", "migrate_as_skill", "Apache-2.0", "Canvas craft rule"),
  skill("composition", "foundation", "migrate_as_skill", "Apache-2.0", "Canvas craft rule"),
  skill("design_brief", "foundation", "migrate_as_skill", "Apache-2.0", "Canvas task brief"),
  skill("design_review", "foundation", "migrate_as_skill", "Apache-2.0", "Optional review dimensions"),
  skill("design_system", "foundation", "migrate_as_skill", "Apache-2.0", "Canvas design constraint"),
  skill("imagery", "foundation", "migrate_as_skill", "Apache-2.0", "Asset placement guidance"),
  skill("layout", "foundation", "migrate_as_skill", "Apache-2.0", "Layout operations guidance"),
  skill("polish", "foundation", "migrate_as_skill", "Apache-2.0", "Subtractive QA pass"),
  skill("responsive", "foundation", "migrate_as_skill", "Apache-2.0", "Multi-frame surface guidance"),
  skill("typography", "foundation", "migrate_as_skill", "Apache-2.0", "Text hierarchy guidance"),
  skill("visual_direction", "foundation", "migrate_as_skill", "Apache-2.0", "Visual thesis guidance"),
  skill("awesome_design_md", "domains", "migrate_as_skill", "MIT; explicit local LICENSE", "Brand constraint method; retain full MIT notice"),
  skill("banner_ad", "domains", "migrate_as_skill", "Apache-2.0", "Deliverable-specific method"),
  skill("brush_ops", "domains", "defer", "Apache-2.0", "Depends on brush assets and durable pencil ops"),
  skill("dashboard_ui", "domains", "migrate_as_skill", "Apache-2.0", "Surface-specific method"),
  skill("ecommerce_surface", "domains", "migrate_as_skill", "Apache-2.0", "Surface-specific method"),
  skill("garden_style", "domains", "migrate_as_skill", "MIT; explicit local LICENSE", "Style method; retain full upstream MIT notice"),
  skill("icon_set", "domains", "migrate_as_skill", "Apache-2.0", "Vector mark method"),
  skill("image_gen", "domains", "defer", "Apache-2.0", "Generation Provider/job is post-MVP"),
  skill("landing_page", "domains", "migrate_as_skill", "Apache-2.0", "Surface-specific method"),
  skill("long_scroll", "domains", "migrate_as_skill", "Apache-2.0", "Surface-specific method"),
  skill("mobile_app_ui", "domains", "migrate_as_skill", "Apache-2.0", "Surface-specific method"),
  skill("motion_lottie", "domains", "defer", "Apache-2.0", "AI motion hydrate/job is deferred"),
  skill("poster_craft", "domains", "migrate_as_skill", "Apache-2.0", "Deliverable-specific method"),
  skill("resume_layout", "domains", "migrate_as_skill", "Apache-2.0", "Deliverable-specific method"),
  skill("shadcn_ui", "domains", "migrate_as_skill", "MIT; explicit local LICENSE", "UI method; retain shadcn MIT notice"),
  skill("type_specimen", "domains", "migrate_as_skill", "Apache-2.0", "Typography deliverable method"),
];

const toolSource = "apps/api/seeds/canvas_actions_seed.json";
const toolOperationDependencies: Readonly<Record<string, readonly string[]>> = {
  update_node: ["Recombyn ToolOps validator", "Recombyn scene model"],
  create_shape: ["Recombyn ToolOps validator", "Recombyn scene model"],
  create_text: ["Recombyn ToolOps validator", "Recombyn scene model"],
  outline_text: ["Recombyn ToolOps validator", "Recombyn scene model", "fontkit", "licensed local fonts"],
  create_image: ["Recombyn ToolOps validator", "Recombyn scene model", "Canvas asset resolver"],
  create_svg: ["Recombyn ToolOps validator", "Recombyn scene model", "Kith SVG sanitizer"],
  create_lottie: ["Recombyn ToolOps validator", "Recombyn scene model", "validated Lottie asset", "Lottie hydrate boundary"],
  create_icon: ["Recombyn ToolOps validator", "Recombyn scene model", "licensed vector source", "Kith SVG sanitizer"],
  create_frame: ["Recombyn ToolOps validator", "Recombyn scene model"],
  delete_nodes: ["Recombyn ToolOps validator", "Recombyn scene model", "destructive-operation confirmation"],
  update_frame: ["Recombyn ToolOps validator", "Recombyn scene model"],
  delete_frame: ["Recombyn ToolOps validator", "Recombyn scene model", "destructive-operation confirmation"],
  align_nodes: ["Recombyn ToolOps validator", "Recombyn scene model", "multi-selection geometry"],
  distribute_nodes: ["Recombyn ToolOps validator", "Recombyn scene model", "multi-selection geometry"],
  reorder_nodes: ["Recombyn ToolOps validator", "Recombyn scene model", "structure ordering"],
  group_nodes: ["Recombyn ToolOps validator", "Recombyn scene model", "structure grouping"],
  ungroup_nodes: ["Recombyn ToolOps validator", "Recombyn scene model", "structure grouping"],
  duplicate_nodes: ["Recombyn ToolOps validator", "Recombyn scene model", "identifier remapping"],
  flip_nodes: ["Recombyn ToolOps validator", "Recombyn scene model", "multi-selection geometry"],
  boolean_op: ["Recombyn ToolOps validator", "Recombyn scene model", "polygon-clipping"],
  set_canvas_background: ["Recombyn ToolOps validator", "Recombyn scene model"],
  set_viewport: ["Recombyn ToolOps validator", "RCB camera projection"],
  image_process: ["Recombyn ToolOps validator", "Canvas asset resolver", "durable image job", "configured image Provider"],
  export_canvas: ["Recombyn ToolOps validator", "Canvas export port", "Canvas asset resolver"],
};

const operation = (key: string, disposition: UpstreamDisposition, reason: string): ManifestItem => ({
  key, source: toolSource, license: "Apache-2.0",
  dependencies: toolOperationDependencies[key] ?? [], disposition, reason,
});

/** Exact 24 ToolOps at Recombyn abd8198. Stage 1 does not expose Agent tools. */
export const RECOMBYN_TOOLOPS_DISPOSITION: readonly ManifestItem[] = [
  operation("update_node", "migrate_as_tool_policy", "Durable element op in stage 4"),
  operation("create_shape", "migrate_as_tool_policy", "Durable element op in stage 4"),
  operation("create_text", "migrate_as_tool_policy", "Durable element op in stage 4"),
  operation("outline_text", "defer", "Requires licensed local fonts and fontkit gate"),
  operation("create_image", "migrate_as_tool_policy", "AssetId-only durable op; generation args removed"),
  operation("create_svg", "migrate_as_tool_policy", "Kith sanitizer required before stage 4"),
  operation("create_lottie", "migrate_as_tool_policy", "Imported asset only; generation args removed"),
  operation("create_icon", "migrate_as_tool_policy", "Sanitized vector op"),
  operation("create_frame", "migrate_as_tool_policy", "Durable frame op"),
  operation("delete_nodes", "migrate_as_tool_policy", "Destructive scoped durable op"),
  operation("update_frame", "migrate_as_tool_policy", "Durable frame op"),
  operation("delete_frame", "migrate_as_tool_policy", "Destructive scoped durable op"),
  operation("align_nodes", "migrate_as_tool_policy", "Atomic multi-element op"),
  operation("distribute_nodes", "migrate_as_tool_policy", "Atomic multi-element op"),
  operation("reorder_nodes", "migrate_as_tool_policy", "Structure-revision op"),
  operation("group_nodes", "migrate_as_tool_policy", "Structure-revision op"),
  operation("ungroup_nodes", "migrate_as_tool_policy", "Structure-revision op"),
  operation("duplicate_nodes", "migrate_as_tool_policy", "Atomic multi-element op"),
  operation("flip_nodes", "migrate_as_tool_policy", "Atomic multi-element op"),
  operation("boolean_op", "migrate_as_tool_policy", "Atomic multi-element op"),
  operation("set_canvas_background", "migrate_as_tool_policy", "Document-revision scene op"),
  operation("set_viewport", "replace_with_kith", "Ephemeral connected-UI suggestion"),
  operation("image_process", "defer", "OCR/SAM/LaMa/generative work requires durable jobs"),
  operation("export_canvas", "replace_with_kith", "Canvas export port; not a scene mutation"),
];
