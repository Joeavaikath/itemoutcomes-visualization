(function () {
  const p = {
    controller: { id: "controller", label: "Backup controller", role: "BC", color: "#38bdf8" },
    recorder: { id: "recorder", label: "Item recorder", role: "Rec", color: "#a78bfa" },
    backupper: { id: "backupper", label: "Backupper", role: "BU", color: "#22d3ee" },
    store: { id: "store", label: "Object store", role: "Store", color: "#f59e0b" },
    volumeInfo: { id: "volume-info", label: "Volume info", role: "VI", color: "#34d399" },
    finalizer: { id: "finalizer", label: "Backup finalizer", role: "Fin", color: "#f472b6" },
    outcomes: { id: "outcomes", label: "Item outcomes finalizer", role: "OF", color: "#c084fc" },
    operations: { id: "operations", label: "Item operation controller", role: "OpC", color: "#fbbf24" },
    api: { id: "api", label: "Kubernetes API", role: "API", color: "#60a5fa" },
    merge: { id: "merge", label: "Merge", role: "Merge", color: "#a3e635" },
    applyOps: { id: "apply-operations", label: "ApplyOperations", role: "Ops", color: "#fb7185" },
    applyVols: { id: "apply-volumes", label: "ApplyVolumes", role: "Vol", color: "#2dd4bf" },
    finalizeRec: { id: "finalize-recorder", label: "Finalize recorder", role: "FR", color: "#c084fc" },
  };

  const ref = (row) => ({
    groupResource: row.groupResource,
    namespace: row.namespace,
    name: row.name,
  });
  const key = (row) => `${row.groupResource}|${row.namespace || ""}|${row.name}`;
  const skipReason = "pod volume path declined the volume";

  const vm = { groupResource: "virtualmachines.kubevirt.io", namespace: "ns", name: "vm1" };
  const vmi = { groupResource: "virtualmachineinstances.kubevirt.io", namespace: "ns", name: "vm1" };
  const virtPod = { groupResource: "pods", namespace: "ns", name: "virt-launcher-vm1" };
  const virtPvc = { groupResource: "persistentvolumeclaims", namespace: "ns", name: "disk1" };

  const configMap = { groupResource: "configmaps", namespace: "demo", name: "app-config" };
  const replicaset = { groupResource: "replicasets.apps", namespace: "demo", name: "demo-rs" };
  const prehookPod = { groupResource: "pods", namespace: "demo", name: "demo-pod" };
  const asyncDisk = { groupResource: "persistentvolumeclaims", namespace: "demo", name: "data-disk" };

  const overlayPod = { groupResource: "pods", namespace: "demo", name: "demo-pod" };
  const overlayDataDisk = { groupResource: "persistentvolumeclaims", namespace: "demo", name: "data-disk" };
  const overlayCacheDisk = { groupResource: "persistentvolumeclaims", namespace: "demo", name: "cache-disk" };
  const overlayJob = { groupResource: "jobs.batch", namespace: "demo", name: "demo-job" };
  const overlayExtra = { groupResource: "configmaps", namespace: "demo", name: "extra-config" };

  const prehookError = "pre hook failed: hook command exited 1";
  const warningMessage = "post-operation warning: plugin returned a warning";
  const operationError = "post-operation failed: snapshot plugin timed out";

  window.SCENARIOS = [
    {
      id: "kubevirt-rescue",
      title: "KubeVirt volume rescue",
      description: "Pod-volume skip, CSI capture, and the finalize rescue.",
      participants: [p.controller, p.recorder, p.backupper, p.store, p.volumeInfo, p.finalizer],
      steps: [
        {
          phase: "prepare",
          from: "controller",
          to: "recorder",
          call: "NewRecorder()",
          narration:
            "Collection is enabled. The controller creates the recorder that will hold the artifact rows for this backup.",
          operation: {
            type: "envelope",
            patch: {
              schemaVersion: "v1",
              kind: "backup",
              backupName: "demo-kubevirt",
              finalized: false,
            },
          },
        },
        {
          phase: "capture",
          from: "backupper",
          to: "recorder",
          call: "Observe(vm1)",
          narration:
            "Processing the VM mints a row at Succeeded. This is the reporting root for the KubeVirt chain.",
          operation: { type: "upsertRow", row: { ...vm, outcome: "Succeeded" } },
          highlight: key(vm),
        },
        {
          phase: "capture",
          from: "backupper",
          to: "recorder",
          call: "SetParent(vmi1 → vm1)",
          narration:
            "The VM names its VMI as an additional item. The edge mints a Named row for the child before the child is processed.",
          operation: {
            type: "upsertRow",
            row: {
              ...vmi,
              outcome: "Named",
              parent: ref(vm),
              parentSource: "additionalItem",
            },
          },
          highlight: key(vmi),
        },
        {
          phase: "capture",
          from: "backupper",
          to: "recorder",
          call: "Observe(vmi1)",
          narration:
            "Processing the VMI promotes the Named row to Succeeded. The parent edge stays intact.",
          operation: { type: "patchRow", key: key(vmi), patch: { outcome: "Succeeded" } },
          highlight: key(vmi),
        },
        {
          phase: "capture",
          from: "backupper",
          to: "recorder",
          call: "SetParent(pod → vmi1)",
          narration:
            "The VMI owns the virt-launcher Pod. The controller owner reference creates an ownerReference edge.",
          operation: {
            type: "upsertRow",
            row: {
              ...virtPod,
              outcome: "Named",
              parent: ref(vmi),
              parentSource: "ownerReference",
            },
          },
          highlight: key(virtPod),
        },
        {
          phase: "capture",
          from: "backupper",
          to: "recorder",
          call: "Observe(pod)",
          narration:
            "Processing the Pod promotes its Named row to Succeeded. The pod is now the reporting parent for its disks.",
          operation: { type: "patchRow", key: key(virtPod), patch: { outcome: "Succeeded" } },
          highlight: key(virtPod),
        },
        {
          phase: "capture",
          from: "backupper",
          to: "recorder",
          call: "SetParent(disk1 → pod)",
          narration:
            "The Pod names its PVC as an additional item. The additionalItem edge mints a Named row for the disk.",
          operation: {
            type: "upsertRow",
            row: {
              ...virtPvc,
              outcome: "Named",
              parent: ref(virtPod),
              parentSource: "additionalItem",
            },
          },
          highlight: key(virtPvc),
        },
        {
          phase: "capture",
          from: "backupper",
          to: "recorder",
          call: "Observe(disk1)",
          narration:
            "Processing the PVC promotes its Named row to Succeeded. The disk has not been skipped yet.",
          operation: { type: "patchRow", key: key(virtPvc), patch: { outcome: "Succeeded" } },
          highlight: key(virtPvc),
        },
        {
          phase: "capture",
          from: "backupper",
          to: "recorder",
          call: "SkipVolume(disk1)",
          narration:
            "The pod-volume path declines the disk. The row becomes Skipped and is marked as a volume-path skip, so a later capture can rescue it.",
          operation: {
            type: "patchRow",
            key: key(virtPvc),
            patch: {
              outcome: "Skipped",
              skippedByVolume: true,
              messages: [`pod volume backup skipped: ${skipReason}`],
            },
          },
          highlight: key(virtPvc),
        },
        {
          phase: "capture",
          from: "backupper",
          to: "recorder",
          call: "RecordVolumeAttempt(PodVolumeBackup)",
          narration:
            "The skip is also kept as capture-time evidence. It will be merged with the volume-info attempts at finalize.",
          operation: {
            type: "patchRow",
            key: key(virtPvc),
            patch: {
              volumeAttempts: [
                { method: "PodVolumeBackup", skipped: true, skippedReason: skipReason },
              ],
            },
          },
          highlight: key(virtPvc),
        },
        {
          phase: "first-write",
          from: "controller",
          to: "store",
          call: "PutBackup(first artifact)",
          narration:
            "The controller writes the first artifact with finalized:false. The rows are provisional, and the PVC still reads Skipped.",
          operation: { type: "envelope", patch: { finalized: false } },
        },
        {
          phase: "finalize",
          from: "volume-info",
          to: "finalizer",
          call: "CSI snapshot succeeded",
          narration:
            "Volume info records that a CSI snapshot captured ns/disk1. The item row still says Skipped.",
          operation: {
            type: "volumeInfo",
            value: {
              pvcNamespace: "ns",
              pvcName: "disk1",
              pvName: "pv-1",
              method: "CSISnapshot",
              result: "succeeded",
            },
          },
        },
        {
          phase: "finalize",
          from: "finalizer",
          to: "recorder",
          call: "ApplyVolumes(disk1)",
          narration:
            "ApplyVolumes folds the volume verdict into the owning PVC row. The volume-path skip is rescued to Succeeded, and the capture-time attempt merges with the CSI attempt.",
          operation: {
            type: "patchRow",
            key: key(virtPvc),
            patch: {
              outcome: "Succeeded",
              volume: {
                pvcNamespace: "ns",
                pvcName: "disk1",
                pvName: "pv-1",
                method: "CSISnapshot",
                result: "succeeded",
                attempts: [
                  { method: "PodVolumeBackup", skipped: true, skippedReason: skipReason },
                  { method: "CSISnapshot", result: "succeeded" },
                ],
              },
            },
            remove: ["volumeAttempts"],
          },
          highlight: key(virtPvc),
        },
        {
          phase: "done",
          from: "finalizer",
          to: "store",
          call: "PutBackupItemOutcomes(final)",
          narration:
            "The final artifact is written with finalized:true. The PVC row is Succeeded, with the volume summary and both attempts attached.",
          operation: { type: "envelope", patch: { finalized: true } },
        },
      ],
    },
    {
      id: "clean-no-operations",
      title: "Clean stateless item",
      description: "One ConfigMap, no item operations, no archive rebuild.",
      participants: [
        p.controller,
        p.recorder,
        p.backupper,
        p.store,
        p.api,
        p.finalizer,
        p.outcomes,
      ],
      steps: [
        {
          phase: "prepare",
          from: "controller",
          to: "recorder",
          call: "NewRecorder()",
          narration:
            "Collection is enabled. The controller creates the recorder for this backup.",
          operation: {
            type: "envelope",
            patch: {
              schemaVersion: "v1",
              kind: "backup",
              backupName: "demo-configmap",
              finalized: false,
            },
          },
        },
        {
          phase: "capture",
          from: "backupper",
          to: "recorder",
          call: "Observe(app-config)",
          narration:
            "The ConfigMap is processed with no warning, failure, or skip. Its row reads Succeeded.",
          operation: { type: "upsertRow", row: { ...configMap, outcome: "Succeeded" } },
          highlight: key(configMap),
        },
        {
          phase: "first-write",
          from: "controller",
          to: "store",
          call: "PutBackup(first artifact)",
          narration:
            "The first artifact is written with finalized:false. The synchronous row is already in place.",
          operation: { type: "envelope", patch: { finalized: false } },
        },
        {
          phase: "finalize",
          from: "controller",
          to: "api",
          call: "patch Finalizing",
          narration:
            "No item operations were created, so the backup moves straight to Finalizing instead of WaitingForPluginOperations.",
        },
        {
          phase: "finalize",
          from: "api",
          to: "finalizer",
          call: "reconcile Finalizing backup",
          narration:
            "The backup finalizer takes the no-item-operations path.",
        },
        {
          phase: "finalize",
          from: "finalizer",
          to: "outcomes",
          call: "FinalizeItemOutcomes()",
          narration:
            "The fast path finalizes the artifact without re-processing items or rebuilding the tarball.",
        },
        {
          phase: "finalize",
          from: "outcomes",
          to: "store",
          call: "GetBackupItemOutcomes()",
          narration:
            "The stored artifact is loaded. It contains the ConfigMap row from the first write.",
        },
        {
          phase: "finalize",
          from: "outcomes",
          to: "outcomes",
          call: "Apply overlays (none)",
          narration:
            "There are no operation results and no volume verdicts. Both overlays are no-ops, and ApplyOperations sets finalized:true.",
          operation: { type: "envelope", patch: { finalized: true } },
        },
        {
          phase: "done",
          from: "outcomes",
          to: "store",
          call: "PutBackupItemOutcomes(final)",
          narration:
            "The final artifact is written. The ConfigMap row is Succeeded and the envelope is finalized.",
          operation: { type: "envelope", patch: { finalized: true } },
        },
        {
          phase: "done",
          from: "finalizer",
          to: "api",
          call: "patch Completed",
          narration:
            "The backup reaches a terminal phase. No archive rebuild was required.",
        },
      ],
    },
    {
      id: "prehook-failure",
      title: "Prehook failure",
      description: "A Pod prehook fails before backupItem, but the row is still captured.",
      participants: [
        p.controller,
        p.recorder,
        p.backupper,
        p.store,
        p.api,
        p.finalizer,
        p.outcomes,
      ],
      steps: [
        {
          phase: "prepare",
          from: "controller",
          to: "recorder",
          call: "NewRecorder()",
          narration:
            "Collection is enabled. The controller creates the recorder for this backup.",
          operation: {
            type: "envelope",
            patch: {
              schemaVersion: "v1",
              kind: "backup",
              backupName: "demo-prehook",
              finalized: false,
            },
          },
        },
        {
          phase: "capture",
          from: "backupper",
          to: "recorder",
          call: "Observe(demo-rs)",
          narration:
            "The ReplicaSet is processed normally and becomes the reporting root for the Pod.",
          operation: { type: "upsertRow", row: { ...replicaset, outcome: "Succeeded" } },
          highlight: key(replicaset),
        },
        {
          phase: "capture",
          from: "backupper",
          to: "recorder",
          call: "SetOwnerParent(demo-pod → demo-rs)",
          narration:
            "Prehooks run before backupItem. The prehook path resolves the controller owner edge and mints the Pod row at Named.",
          operation: {
            type: "upsertRow",
            row: {
              ...prehookPod,
              outcome: "Named",
              parent: ref(replicaset),
              parentSource: "ownerReference",
            },
          },
          highlight: key(prehookPod),
        },
        {
          phase: "capture",
          from: "backupper",
          to: "recorder",
          call: "Fail(demo-pod, pre hook failed)",
          narration:
            "The prehook fails. The Pod row is raised to Failed, the error is appended, and the item is marked handled so backupItem is skipped.",
          operation: {
            type: "patchRow",
            key: key(prehookPod),
            patch: { outcome: "Failed", messages: [prehookError] },
          },
          highlight: key(prehookPod),
        },
        {
          phase: "first-write",
          from: "controller",
          to: "store",
          call: "PutBackup(first artifact)",
          narration:
            "The first artifact already contains the ReplicaSet and the failed Pod row.",
          operation: { type: "envelope", patch: { finalized: false } },
        },
        {
          phase: "finalize",
          from: "controller",
          to: "api",
          call: "patch Finalizing",
          narration:
            "No item operations were created, so the backup moves directly to Finalizing.",
        },
        {
          phase: "finalize",
          from: "api",
          to: "finalizer",
          call: "reconcile Finalizing backup",
          narration:
            "The finalizer takes the no-item-operations path.",
        },
        {
          phase: "finalize",
          from: "finalizer",
          to: "outcomes",
          call: "FinalizeItemOutcomes()",
          narration:
            "The artifact is finalized without re-processing or rebuilding the archive.",
        },
        {
          phase: "finalize",
          from: "outcomes",
          to: "store",
          call: "GetBackupItemOutcomes()",
          narration: "The stored artifact is loaded with the failed Pod row.",
        },
        {
          phase: "finalize",
          from: "outcomes",
          to: "outcomes",
          call: "Apply overlays (none)",
          narration:
            "There are no operation or volume results. The overlays leave the Pod Failed and set finalized:true.",
          operation: { type: "envelope", patch: { finalized: true } },
        },
        {
          phase: "done",
          from: "outcomes",
          to: "store",
          call: "PutBackupItemOutcomes(final)",
          narration:
            "The final artifact is written. The Pod row remains Failed with its parent edge and prehook message.",
          operation: { type: "envelope", patch: { finalized: true } },
        },
        {
          phase: "done",
          from: "finalizer",
          to: "api",
          call: "patch PartiallyFailed",
          narration:
            "The backup finishes partially failed because the prehook error was recorded.",
        },
      ],
    },
    {
      id: "async-bia-failure",
      title: "Async BIA failure",
      description: "An operation settles after the first write and fails the item at finalize.",
      participants: [
        p.controller,
        p.recorder,
        p.backupper,
        p.store,
        p.api,
        p.operations,
        p.finalizer,
        p.outcomes,
      ],
      steps: [
        {
          phase: "prepare",
          from: "controller",
          to: "recorder",
          call: "NewRecorder()",
          narration:
            "Collection is enabled. The controller creates the recorder for this backup.",
          operation: {
            type: "envelope",
            patch: {
              schemaVersion: "v1",
              kind: "backup",
              backupName: "demo-async",
              finalized: false,
            },
          },
        },
        {
          phase: "capture",
          from: "backupper",
          to: "recorder",
          call: "Observe(data-disk)",
          narration:
            "The PVC is processed synchronously and reads Succeeded before the asynchronous action runs.",
          operation: { type: "upsertRow", row: { ...asyncDisk, outcome: "Succeeded" } },
          highlight: key(asyncDisk),
        },
        {
          phase: "capture",
          from: "backupper",
          to: "api",
          call: "create BackupOperation",
          narration:
            "A BackupItemAction creates an asynchronous operation. The item is backed up, but the operation verdict is still outstanding.",
        },
        {
          phase: "capture",
          from: "api",
          to: "operations",
          call: "reconcile BackupOperation",
          narration:
            "The item operation controller starts reconciling the operation.",
        },
        {
          phase: "first-write",
          from: "controller",
          to: "store",
          call: "PutBackup(first artifact)",
          narration:
            "The first artifact is written with the PVC still Succeeded and finalized:false.",
          operation: { type: "envelope", patch: { finalized: false } },
        },
        {
          phase: "operations",
          from: "controller",
          to: "api",
          call: "patch WaitingForPluginOperations",
          narration:
            "Because an item operation is in progress, the backup waits instead of finalizing immediately.",
        },
        {
          phase: "operations",
          from: "api",
          to: "operations",
          call: "reconcile BackupOperation",
          narration: "The operations controller continues to reconcile the operation.",
        },
        {
          phase: "operations",
          from: "operations",
          to: "api",
          call: "operation failed; patch FinalizingPartiallyFailed",
          narration:
            "The operation fails. The backup moves to FinalizingPartiallyFailed and the finalizer will pick it up.",
        },
        {
          phase: "finalize",
          from: "api",
          to: "finalizer",
          call: "reconcile FinalizingPartiallyFailed backup",
          narration:
            "The finalizer sees that item operations exist and takes the rebuild path.",
        },
        {
          phase: "finalize",
          from: "finalizer",
          to: "backupper",
          call: "FinalizeBackup(...)",
          narration:
            "FinalizeBackup re-processes the post-operation items and prepares the final archive.",
        },
        {
          phase: "finalize",
          from: "backupper",
          to: "recorder",
          call: "re-process post-operation items",
          narration:
            "The finalize pass captures any outcome recorded while re-processing the item.",
        },
        {
          phase: "finalize",
          from: "backupper",
          to: "backupper",
          call: "build final tarball",
          narration:
            "The archive is rebuilt into a temp file before the item outcomes artifact is finalized.",
        },
        {
          phase: "finalize",
          from: "backupper",
          to: "outcomes",
          call: "finalizeItemOutcomes(...)",
          narration:
            "The item outcomes finalizer receives the stored artifact, the finalize rows, the operation results, and the volume info.",
        },
        {
          phase: "finalize",
          from: "outcomes",
          to: "store",
          call: "GetBackupItemOutcomes()",
          narration: "The stored artifact is loaded.",
        },
        {
          phase: "finalize",
          from: "outcomes",
          to: "recorder",
          call: "Result()",
          narration: "The finalize-pass recorder produces its rows.",
        },
        {
          phase: "finalize",
          from: "outcomes",
          to: "outcomes",
          call: "Apply overlays",
          narration:
            "Merge folds the finalize rows in. ApplyOperations applies the settled operation failure and raises the PVC to Failed with the operation error. ApplyVolumes has no verdict for this disk.",
          operations: [
            {
              type: "patchRow",
              key: key(asyncDisk),
              patch: {
                outcome: "Failed",
                messages: [`snapshot failed: ${operationError}`],
              },
            },
            { type: "envelope", patch: { finalized: true } },
          ],
          highlight: key(asyncDisk),
        },
        {
          phase: "finalize",
          from: "outcomes",
          to: "store",
          call: "PutBackupItemOutcomes(final)",
          narration:
            "The artifact is written with the PVC Failed and finalized:true.",
          operation: { type: "envelope", patch: { finalized: true } },
        },
        {
          phase: "done",
          from: "finalizer",
          to: "store",
          call: "PutBackupContents(final tarball)",
          narration:
            "The rebuilt archive is uploaded after the artifact is finalized.",
        },
        {
          phase: "done",
          from: "finalizer",
          to: "api",
          call: "patch PartiallyFailed",
          narration:
            "The backup finishes partially failed because the async operation failed.",
        },
      ],
    },
    {
      id: "finalize-overlays",
      title: "Finalize overlays",
      description: "Merge, ApplyOperations, and ApplyVolumes over one stored artifact.",
      participants: [p.finalizer, p.store, p.finalizeRec, p.merge, p.applyOps, p.applyVols, p.volumeInfo],
      steps: [
        {
          phase: "finalize",
          from: "finalizer",
          to: "store",
          call: "GetBackupItemOutcomes()",
          narration:
            "The stored artifact from the first write is loaded. It has capture rows and one capture-time volume attempt.",
          operation: {
            type: "snapshot",
            value: {
              schemaVersion: "v1",
              kind: "backup",
              backupName: "demo-overlays",
              finalized: false,
              items: [
                { ...overlayPod, outcome: "Succeeded" },
                {
                  ...overlayDataDisk,
                  outcome: "Skipped",
                  skippedByVolume: true,
                  messages: [`pod volume backup skipped: ${skipReason}`],
                  volumeAttempts: [
                    { method: "PodVolumeBackup", skipped: true, skippedReason: skipReason },
                  ],
                },
                { ...overlayCacheDisk, outcome: "Succeeded" },
              ],
            },
          },
        },
        {
          phase: "finalize",
          from: "finalizer",
          to: "finalize-recorder",
          call: "Result()",
          narration:
            "The finalize pass produced rows for post-operation re-processing: a warning on the Pod and a new ConfigMap.",
        },
        {
          phase: "finalize",
          from: "finalizer",
          to: "merge",
          call: "Merge(stored, finalizeRows)",
          narration:
            "Merge joins by exact key, raises the Pod to Warning, adds the new ConfigMap row, and leaves the envelope untouched.",
          operations: [
            {
              type: "patchRow",
              key: key(overlayPod),
              patch: { outcome: "Warning", messages: [warningMessage] },
            },
            { type: "upsertRow", row: { ...overlayExtra, outcome: "Succeeded" } },
          ],
          highlight: key(overlayPod),
        },
        {
          phase: "finalize",
          from: "merge",
          to: "finalizer",
          call: "merged artifact",
          narration:
            "The stored artifact now has the finalize warning and the new row. Merge did not change finalized.",
        },
        {
          phase: "finalize",
          from: "finalizer",
          to: "apply-operations",
          call: "ApplyOperations(stored, operationResults)",
          narration:
            "A matched failed operation raises the Pod to Failed and appends its error. An unmatched failed operation creates a new Failed Job row. A succeeded operation is a no-op.",
          operations: [
            {
              type: "patchRow",
              key: key(overlayPod),
              patch: { outcome: "Failed", messages: [warningMessage, operationError] },
            },
            {
              type: "upsertRow",
              row: {
                ...overlayJob,
                outcome: "Failed",
                messages: ["operation failed: no captured row"],
              },
            },
            { type: "envelope", patch: { finalized: true } },
          ],
          highlight: key(overlayPod),
        },
        {
          phase: "finalize",
          from: "apply-operations",
          to: "finalizer",
          call: "operation overlay",
          narration:
            "ApplyOperations owns finalized. It never changes Parent. A pending operation would leave finalized false.",
        },
        {
          phase: "finalize",
          from: "finalizer",
          to: "apply-volumes",
          call: "ApplyVolumes(stored, volumeInfos)",
          narration:
            "The volume fold starts from the exact volume identity and the attempts already attached to the row.",
        },
        {
          phase: "finalize",
          from: "apply-volumes",
          to: "volume-info",
          call: "group by (pvcNamespace, pvcName, pvName)",
          narration:
            "Volume info has three volumes: data-disk succeeded with two paths, cache-disk failed, and orphan-disk with no matching row.",
          operation: {
            type: "volumeInfo",
            value: [
              {
                pvcNamespace: "demo",
                pvcName: "data-disk",
                pvName: "pv-data",
                method: "CSISnapshot",
                result: "succeeded",
                attempts: 2,
              },
              {
                pvcNamespace: "demo",
                pvcName: "cache-disk",
                pvName: "pv-cache",
                method: "CSISnapshot",
                result: "failed",
              },
              {
                pvcNamespace: "demo",
                pvcName: "orphan-disk",
                pvName: "pv-orphan",
                method: "CSISnapshot",
                result: "succeeded",
              },
            ],
          },
        },
        {
          phase: "finalize",
          from: "volume-info",
          to: "apply-volumes",
          call: "attempts per volume",
          narration:
            "The fold merges the PodVolumeBackup skip from the row with the CSI success from volume info, dedupes and sorts the attempts, and caps them.",
        },
        {
          phase: "finalize",
          from: "apply-volumes",
          to: "finalizer",
          call: "folded artifact",
          narration:
            "data-disk is rescued to Succeeded with a two-attempt summary. cache-disk becomes Failed. orphan-disk is dropped because no row matches.",
          operations: [
            {
              type: "patchRow",
              key: key(overlayDataDisk),
              patch: {
                outcome: "Succeeded",
                volume: {
                  pvcNamespace: "demo",
                  pvcName: "data-disk",
                  pvName: "pv-data",
                  method: "CSISnapshot",
                  result: "succeeded",
                  attempts: [
                    { method: "PodVolumeBackup", skipped: true, skippedReason: skipReason },
                    { method: "CSISnapshot", result: "succeeded" },
                  ],
                },
              },
              remove: ["volumeAttempts"],
            },
            {
              type: "patchRow",
              key: key(overlayCacheDisk),
              patch: {
                outcome: "Failed",
                messages: ["volume pvc=demo/cache-disk pv=pv-cache (CSISnapshot) failed"],
                volume: {
                  pvcNamespace: "demo",
                  pvcName: "cache-disk",
                  pvName: "pv-cache",
                  method: "CSISnapshot",
                  result: "failed",
                },
              },
            },
          ],
          highlight: key(overlayDataDisk),
        },
        {
          phase: "done",
          from: "finalizer",
          to: "store",
          call: "PutBackupItemOutcomes(final)",
          narration:
            "The final artifact is written. The envelope is already finalized by ApplyOperations, and the volume summary and attempts are attached.",
          operation: { type: "envelope", patch: { finalized: true } },
        },
      ],
    },
  ];
})();
