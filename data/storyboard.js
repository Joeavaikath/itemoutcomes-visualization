(function () {
  const vm = {
    groupResource: "virtualmachines.kubevirt.io",
    namespace: "ns",
    name: "vm1",
  };
  const vmi = {
    groupResource: "virtualmachineinstances.kubevirt.io",
    namespace: "ns",
    name: "vm1",
  };
  const pod = {
    groupResource: "pods",
    namespace: "ns",
    name: "virt-launcher-vm1",
  };
  const pvc = {
    groupResource: "persistentvolumeclaims",
    namespace: "ns",
    name: "disk1",
  };

  const ref = (row) => ({
    groupResource: row.groupResource,
    namespace: row.namespace,
    name: row.name,
  });
  const key = (row) => `${row.groupResource}|${row.namespace || ""}|${row.name}`;
  const skipReason = "pod volume path declined the volume";

  window.PARTICIPANTS = [
    { id: "controller", label: "Backup controller", role: "BC", color: "#38bdf8" },
    { id: "recorder", label: "Item recorder", role: "Rec", color: "#a78bfa" },
    { id: "backupper", label: "Backupper", role: "BU", color: "#22d3ee" },
    { id: "store", label: "Object store", role: "Store", color: "#f59e0b" },
    { id: "volume-info", label: "Volume info", role: "VI", color: "#34d399" },
    { id: "finalizer", label: "Backup finalizer", role: "Fin", color: "#f472b6" },
  ];

  window.STORYBOARD = [
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
          ...pod,
          outcome: "Named",
          parent: ref(vmi),
          parentSource: "ownerReference",
        },
      },
      highlight: key(pod),
    },
    {
      phase: "capture",
      from: "backupper",
      to: "recorder",
      call: "Observe(pod)",
      narration:
        "Processing the Pod promotes its Named row to Succeeded. The pod is now the reporting parent for its disks.",
      operation: { type: "patchRow", key: key(pod), patch: { outcome: "Succeeded" } },
      highlight: key(pod),
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
          ...pvc,
          outcome: "Named",
          parent: ref(pod),
          parentSource: "additionalItem",
        },
      },
      highlight: key(pvc),
    },
    {
      phase: "capture",
      from: "backupper",
      to: "recorder",
      call: "Observe(disk1)",
      narration:
        "Processing the PVC promotes its Named row to Succeeded. The disk has not been skipped yet.",
      operation: { type: "patchRow", key: key(pvc), patch: { outcome: "Succeeded" } },
      highlight: key(pvc),
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
        key: key(pvc),
        patch: {
          outcome: "Skipped",
          skippedByVolume: true,
          messages: [`pod volume backup skipped: ${skipReason}`],
        },
      },
      highlight: key(pvc),
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
        key: key(pvc),
        patch: {
          volumeAttempts: [
            {
              method: "PodVolumeBackup",
              skipped: true,
              skippedReason: skipReason,
            },
          ],
        },
      },
      highlight: key(pvc),
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
        key: key(pvc),
        patch: {
          outcome: "Succeeded",
          volume: {
            pvcNamespace: "ns",
            pvcName: "disk1",
            pvName: "pv-1",
            method: "CSISnapshot",
            result: "succeeded",
            attempts: [
              {
                method: "PodVolumeBackup",
                skipped: true,
                skippedReason: skipReason,
              },
              { method: "CSISnapshot", result: "succeeded" },
            ],
          },
        },
        remove: ["volumeAttempts"],
      },
      highlight: key(pvc),
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
  ];
})();
