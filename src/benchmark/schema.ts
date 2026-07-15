import type { FromSchema, JSONSchema } from "json-schema-to-ts";

const exactObject = <const Properties extends Record<string, JSONSchema>>(
  properties: Properties,
) =>
  ({
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties) as (keyof Properties & string)[],
    properties,
  }) as const;

const partitionSchema = (
  applicationCount: 10 | 5,
  plannedPairCount: 320 | 160,
  relationCount: 160 | 80,
) =>
  exactObject({
    application_count: { const: applicationCount },
    planned_pair_count: { const: plannedPairCount },
    planned_relation_counts: exactObject({
      declared_breaking: { const: relationCount },
      task_preserving_control: { const: relationCount },
    }),
  });

export const pilotProtocolSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://impactdiff.dev/schemas/pilot-protocol-v1.json",
  title: "ImpactDiff Pilot v0.1 frozen protocol",
  ...exactObject({
    contract: { const: "impactdiff.pilot-protocol" },
    version: { const: 1 },
    protocol_release: { const: "pilot-v0.1" },
    protocol_id: { type: "string", pattern: "^idpp1_[0-9a-f]{64}$" },
    design: exactObject({
      application_count: { const: 20 },
      tasks_per_application: { const: 2 },
      family_ids: {
        const: [
          "pointer_hit_testing",
          "overflow_clipping",
          "target_displacement",
          "native_control_state",
          "focus_navigation",
          "accessible_naming",
          "content_overflow",
          "visual_presentation",
        ],
      },
      declared_relation_variants: {
        const: ["declared_breaking", "task_preserving_control"],
      },
      replicates: { const: [0] },
      checkpoint_ids: {
        const: ["initial_state", "pre_primary_action", "post_primary_action"],
      },
      planned_pair_count: { const: 640 },
      matrix: { const: "complete_cartesian_product" },
      cell_keys_frozen_before_execution: { const: true },
      outcome_dependent_resampling: { const: false },
      outcome_dependent_replacement: { const: false },
      technical_failure_disposition: {
        const: "record_and_retry_same_predeclared_cell_only",
      },
      baseline_failure_disposition: {
        const: "retain_as_invalid_never_negative",
      },
      pre_outcome_generation_plan: exactObject({
        binding_id_fields: {
          const: [
            "application_group_id",
            "workflow_id",
            "source_state_id",
            "mutation_family_id",
            "operator_id",
            "split_id",
          ],
        },
        cell_key_fields: {
          const: [
            "application_group_id",
            "workflow_id",
            "source_state_id",
            "mutation_family_id",
            "operator_id",
            "declared_relation_variant",
            "replicate",
          ],
        },
        expected_cell_count: { const: 640 },
        matrix_membership: { const: "every_predeclared_cell_exactly_once" },
        source_state_binding: {
          const: "fixed_per_application_workflow_across_all_operators",
        },
        operator_binding: {
          const: "fixed_per_family_relation_across_all_applications_workflows",
        },
        application_block_binding: {
          const: "one_outer_block_per_application_group",
        },
        content_addressed: { const: true },
        frozen_before_first_execution: { const: true },
      }),
    }),
    environment: exactObject({
      viewport: exactObject({
        width_px: { const: 800 },
        height_px: { const: 600 },
      }),
      locale: { const: "en-US" },
      timezone: { const: "UTC" },
      color_scheme: { const: "light" },
      font_family: { const: "Noto Sans" },
    }),
    labels: exactObject({
      primary_label: { const: "task_regression" },
      label_type: { const: "binary" },
      measured_from: { const: "independent_task_replay" },
      positive_rule: { const: "baseline_success_and_candidate_failure" },
      negative_rule: { const: "baseline_success_and_candidate_success" },
      invalid_rule: { const: "baseline_failure" },
      declared_relation_is_not_label: { const: true },
    }),
    data_boundary: exactObject({
      feature_worker_inputs_exactly: {
        const: ["sanitized_visible_projection", "frozen_feature_config"],
      },
      feature_worker_outputs_exactly: {
        const: ["numeric_feature_matrices", "row_map"],
      },
      modality_projection_payloads: exactObject({
        pixel: { const: ["canonical_png"] },
        structured: { const: ["accessibility_tree", "layout_graph"] },
      }),
      prohibited_feature_inputs: {
        const: [
          "sealed_artifacts",
          "mutation_operator_ids",
          "execution_outcomes",
          "failed_step_ids",
          "group_ids",
          "content_digests",
          "artifact_filenames",
          "paths",
          "row_order",
          "archive_membership",
          "capture_task_source_ids",
        ],
      },
      raw_visible_store_mount: { const: "absent" },
      sanitized_projection_access: { const: "read_only" },
      network_access: { const: "disabled" },
      home_mount: { const: "absent" },
      repository_mount: { const: "absent" },
      sealed_store_mount: { const: "absent" },
      sealed_perturbation_feature_bytes: { const: "must_remain_identical" },
      os_isolation_required_before_leakage_safety_claim: { const: true },
      violation_disposition: { const: "block_benchmark_claim" },
    }),
    split: exactObject({
      primary_protocol: { const: "four_fold_grouped_application_outer_cv" },
      assignment_timing: { const: "before_any_task_outcome" },
      application_groups_disjoint_within_each_fold: { const: true },
      transitive_shared_assets_stay_within_application_block: { const: true },
      shared_infrastructure_exemption: exactObject({
        policy_bound_allowlist_required: { const: true },
        frozen_before_asset_grouping: { const: true },
        permitted_categories: {
          const: ["capture_harness", "noto_sans_font", "license_text"],
        },
        application_owned_assets_exempt: { const: false },
      }),
      application_block_count: { const: 4 },
      applications_per_block: { const: 5 },
      outer_fold_count: { const: 4 },
      role_schedule: {
        const: [
          {
            fold_id: "outer_0",
            train_blocks: ["block_2", "block_3"],
            validation_blocks: ["block_1"],
            test_blocks: ["block_0"],
          },
          {
            fold_id: "outer_1",
            train_blocks: ["block_3", "block_0"],
            validation_blocks: ["block_2"],
            test_blocks: ["block_1"],
          },
          {
            fold_id: "outer_2",
            train_blocks: ["block_0", "block_1"],
            validation_blocks: ["block_3"],
            test_blocks: ["block_2"],
          },
          {
            fold_id: "outer_3",
            train_blocks: ["block_1", "block_2"],
            validation_blocks: ["block_0"],
            test_blocks: ["block_3"],
          },
        ],
      },
      per_fold_partitions: exactObject({
        train: partitionSchema(10, 320, 160),
        validation: partitionSchema(5, 160, 80),
        test: partitionSchema(5, 160, 80),
      }),
      outer_test_coverage: exactObject({
        application_count: { const: 20 },
        planned_pair_count: { const: 640 },
        each_application_test_exactly_once: { const: true },
        each_planned_pair_predicted_exactly_once_per_model: { const: true },
      }),
      secondary_diagnostic_slice_ids: {
        const: ["mutation_family_holdout", "joint_application_and_family_holdout"],
      },
      secondary_diagnostic_slices_claim_eligible: { const: false },
    }),
    evaluation: exactObject({
      learned_model_ids: {
        const: ["learned_pixel_only", "learned_structured_only", "learned_fused"],
      },
      deterministic_supporting_baseline_ids: {
        const: [
          "absolute_pixel_change",
          "structural_image_similarity",
          "layout_graph_edit_distance",
          "accessibility_tree_edit_distance",
        ],
      },
      model_input_modalities: exactObject({
        learned_pixel_only: { const: ["canonical_png"] },
        learned_structured_only: {
          const: ["accessibility_tree", "layout_graph"],
        },
        learned_fused: {
          const: ["pixel_expert_logit", "structured_expert_logit"],
        },
      }),
      fusion_training: exactObject({
        architecture: { const: "late_logit_fusion" },
        stacker_model: { const: "l2_logistic_regression" },
        stacker_training_inputs: {
          const: "grouped_cross_fit_base_model_logits_from_fold_training_role",
        },
        cross_fit_group: { const: "application_group" },
        in_sample_base_model_logits: { const: "forbidden" },
        base_model_refit: { const: "full_fold_training_role_after_cross_fit" },
        validation_and_test_inputs: { const: "refit_base_model_logits" },
      }),
      population: exactObject({
        baseline_invalid_rows: { const: "exclude_from_metrics_and_report_count" },
        prediction_coverage: {
          const:
            "every_planned_outer_test_row_exactly_once_per_model_before_matching_outer_test_labels",
        },
        metric_population: { const: "common_baseline_valid_rows_only" },
        supervised_fit_calibration_and_threshold_population: {
          const: "common_baseline_valid_rows_only",
        },
        baseline_invalid_row_use: {
          const: "prediction_coverage_and_reported_count_only",
        },
        common_row_set_required: { const: true },
        model_specific_filtering: { const: false },
        missing_prediction_disposition: { const: "block_release" },
      }),
      outer_fold_orchestration: exactObject({
        global_algorithm_features_and_search_space_frozen_before_any_role_labels: {
          const: true,
        },
        fold_model_test_label_access: { const: "forbidden" },
        test_prediction_label_dependencies: {
          const: "matching_fold_train_and_validation_roles_only",
        },
        fold_calibration_scope: { const: "its_validation_block_only" },
        cross_fold_label_or_metric_feedback: { const: "forbidden" },
        trusted_orchestrator_enforces_fold_scoped_views: { const: true },
        cross_fold_model_or_prediction_substitution: { const: false },
        outer_test_predictions_sealed_before_pooled_scoring: { const: true },
        pooled_outer_metrics_computed_once: { const: true },
      }),
      temporal_view_ids: {
        const: ["initial_only", "post_primary_action_only", "all_checkpoints"],
      },
      claim_temporal_view: { const: "all_checkpoints" },
      diagnostic_temporal_view_ids: {
        const: ["initial_only", "post_primary_action_only"],
      },
      primary_metric: { const: "average_precision" },
      secondary_metric_ids: {
        const: [
          "auroc",
          "recall_at_5_percent_benign_fpr",
          "brier_score",
          "expected_calibration_error",
          "task_regression_recall",
          "task_non_regression_recall",
        ],
      },
      recall_at_5_percent_benign_fpr: exactObject({
        threshold_selected_on: { const: "per_fold_validation" },
        threshold_applied_once_to: { const: "matching_outer_test_fold" },
      }),
      expected_calibration_error: exactObject({
        bin_count: { const: 10 },
        binning: { const: "equal_width" },
      }),
      eligibility_gates: exactObject({
        per_fold_training: exactObject({
          minimum_application_groups: { const: 10 },
          out_of_fold_logits_required: { const: true },
        }),
        per_fold_validation: exactObject({
          minimum_application_groups: { const: 5 },
          minimum_measured_task_regressions: { const: 50 },
          minimum_measured_task_non_regressions: { const: 50 },
        }),
        per_fold_test: exactObject({
          minimum_application_groups: { const: 5 },
          minimum_measured_task_regressions: { const: 50 },
          minimum_measured_task_non_regressions: { const: 50 },
        }),
        pooled_outer_test: exactObject({
          minimum_application_groups: { const: 20 },
          minimum_measured_task_regressions: { const: 200 },
          minimum_measured_task_non_regressions: { const: 200 },
        }),
        each_outer_test_application: exactObject({
          minimum_measured_task_regressions: { const: 8 },
          minimum_measured_task_non_regressions: { const: 8 },
        }),
        failure_disposition: { const: "no_benchmark_claim" },
      }),
      performance_reporting: exactObject({
        required_metric_ids: {
          const: [
            "latency_p50_ms",
            "latency_p95_ms",
            "peak_rss_bytes",
            "model_bundle_bytes",
            "feature_artifact_bytes",
            "per_item_artifact_bytes",
          ],
        },
        cpu_threads: { const: 1 },
        exact_environment_recorded: { const: true },
        blocking_thresholds: { const: false },
      }),
    }),
    release_gates: exactObject({
      maximum_complete_model_bundle_bytes: { const: 5_242_880 },
      fused_bundle_scope: {
        const: "pixel_expert_structured_expert_stacker_and_preprocessors",
      },
      interchange_format: { const: "onnx" },
      native_onnx_probability_parity: exactObject({
        probability_scale: { const: 1_000_000 },
        maximum_scaled_absolute_difference: { const: 1 },
      }),
      release_preconditions: exactObject({
        complete_generation_matrix_required: { const: true },
        required_matrix_cell_count: { const: 640 },
        resolved_replay_required: { const: true },
        contamination_checks_required: { const: true },
        isolated_feature_runner_required_for_benchmark_claim: { const: true },
        sealed_canary_inaccessible_test_required: { const: true },
        modality_projection_access_tests_required: { const: true },
        row_reorder_invariance_test_required: { const: true },
        sealed_perturbation_invariance_test_required: { const: true },
      }),
    }),
    release_reproducibility: exactObject({
      deterministic_rerun_hashes_required_for: {
        const: ["feature_artifacts", "model_artifacts", "predictions", "metrics"],
      },
      tables_and_plots_derived_from: { const: "released_prediction_files_only" },
      visible_and_sealed_archives: { const: "separate" },
      required_asset_ids: {
        const: [
          "visible_archive",
          "sealed_archive",
          "split_assignment",
          "split_audit",
          "generation_plan",
          "feature_config",
          "evaluation_config",
          "row_map",
          "predictions",
          "metrics",
          "confidence_intervals",
          "model_bundles",
          "training_config",
          "checksums",
          "data_card",
          "model_card",
          "report",
          "licenses",
          "third_party_notices",
          "reproduction_manifest",
        ],
      },
      failure_disposition: { const: "block_release" },
    }),
    fusion_claim_gate: exactObject({
      subject: { const: "learned_fused" },
      comparators: {
        const: ["learned_pixel_only", "learned_structured_only"],
      },
      comparator_selection: { const: "all_predeclared_no_test_selection" },
      metric: { const: "average_precision" },
      difference: { const: "subject_minus_comparator" },
      evaluated_on: { const: "concatenated_outer_test_predictions" },
      paired_rows: { const: "same_valid_rows_for_all_models" },
      temporal_view: { const: "all_checkpoints" },
      claim_scope: {
        const: "predeclared_four_fold_training_procedure",
      },
      full_data_retrain_metrics_claim_eligible: { const: false },
      bootstrap: exactObject({
        method: { const: "paired_application_cluster_percentile" },
        application_group_count: { const: 20 },
        sampled_cluster_contents: { const: "all_rows_with_multiplicity" },
        comparisons_use_same_resamples: { const: true },
        resamples: { const: 10_000 },
        seed: { const: 20_260_715 },
        confidence_level_percent: { const: 95 },
      }),
      decision_rule: {
        const: "every_comparison_lower_bound_strictly_greater_than_zero",
      },
      undefined_or_single_class_disposition: { const: "no_claim" },
    }),
    nonclaims: {
      const: [
        "universal_severity_scale",
        "learned_localization",
        "arbitrary_websites",
        "state_of_the_art",
        "production_readiness",
        "classifier_causality",
        "accessibility_harm_beyond_declared_oracle",
        "leakage_safety_without_os_isolation",
      ],
    },
  }),
} as const satisfies JSONSchema;

export type PilotProtocol = FromSchema<typeof pilotProtocolSchema>;
export const pilotProtocolContract = "impactdiff.pilot-protocol" as const;
export const pilotProtocolVersion = 1 as const;
export const pilotProtocolRelease = "pilot-v0.1" as const;
