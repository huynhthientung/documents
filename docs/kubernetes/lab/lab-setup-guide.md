---
id: lab-setup-guide
title: "Home Lab: K8s Cluster with GPU Node"
tags: [kubernetes, gpu, kvm, qemu, cilium, argocd, nvidia, homelab, vfio, passthrough]
---

# Home Lab: K8s Cluster with GPU Node

**Ubuntu Desktop + KVM/QEMU + Kubernetes + Cilium + NVIDIA GPU Passthrough + ArgoCD**

> Dual boot alongside Windows for gaming.
> Hardware: AMD Ryzen 5 9600X | 32 GB RAM | 1 TB SSD | RTX 5060 Ti 16 GB | April 2026

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Phase 1: Install Ubuntu Desktop (Dual Boot)](#2-phase-1-install-ubuntu-desktop-dual-boot)
3. [Phase 2: Enable IOMMU & Configure GPU Passthrough (VFIO)](#3-phase-2-enable-iommu--configure-gpu-passthrough-vfio)
4. [Phase 3: Install KVM/QEMU & Libvirt](#4-phase-3-install-kvmqemu--libvirt)
5. [Phase 4: Setup Bridge Network](#5-phase-4-setup-bridge-network)
6. [Phase 5: Create Virtual Machines](#6-phase-5-create-virtual-machines)
7. [Phase 6: Install Kubernetes (kubeadm)](#7-phase-6-install-kubernetes-kubeadm)
8. [Phase 7: Install Cilium CNI](#8-phase-7-install-cilium-cni-native-routing)
9. [Phase 8: Join gpu-worker VM as GPU Worker Node](#9-phase-8-join-gpu-worker-vm-as-gpu-worker-node)
10. [Phase 9: NVIDIA Container Toolkit](#10-phase-9-nvidia-container-toolkit)
11. [Phase 10: ArgoCD — GitOps with lespaul-argo_cd](#11-phase-10-argocd--gitops-with-lespaul-argo_cd)
12. [Phase 11: Verification & Testing](#12-phase-11-verification--testing)
13. [Phase 12: Jenkins Kubernetes Agent (Dynamic Pod Agents)](#13-phase-12-jenkins-kubernetes-agent-dynamic-pod-agents)
14. [Resource Allocation Summary](#14-resource-allocation-summary)
15. [Troubleshooting](#15-troubleshooting)
16. [Maintenance & Tips](#16-maintenance--tips)

---

## Node Legend

| Symbol | Meaning |
|--------|---------|
| 🖥️ `[HOST]` | Ubuntu Desktop host machine (iGPU, manages VMs — not a k8s node) |
| 🎛️ `[controlplane]` | VM control plane |
| 👷 `[worker1, worker2]` | VM worker nodes (CPU) |
| 🎮 `[gpu-worker]` | VM worker node (dGPU passthrough — RTX 5060 Ti) |
| 🌐 `[ALL NODES]` | controlplane + worker1 + worker2 + gpu-worker |
| 🧑‍💼 `[kubectl client]` | Any machine with kubeconfig (usually host) |
| 🔨 `[docker-builder]` | Jenkins VM agent for Docker image builds |

---

## 1. Architecture Overview

### 1.1 Final Cluster Layout

| Node | Role | vCPU | RAM | IP |
|------|------|------|-----|----|
| controlplane (VM) | Control Plane | 2 | 4 GB | 192.168.100.200 |
| worker1 (VM) | Worker (CPU) | 2 | 4 GB | 192.168.100.201 |
| worker2 (VM) | Worker (CPU) | 2 | 4 GB | 192.168.100.202 |
| gpu-worker (VM) | Worker (dGPU) | 4 | 8 GB | 192.168.100.210 |
| jenkins-master (VM) | Jenkins CI | 2 | 4 GB | 192.168.100.170 |
| docker-builder (VM) | Jenkins Docker Agent | 2 | 4 GB | 192.168.100.171 |
| nfs-server (VM) | NFS Storage | 1 | 1 GB | 192.168.100.180 |


### 1.2 Key Design Decisions

- **Bridge networking (`br-k8s`, `192.168.100.0/24`):** all VMs — including `gpu-worker` — share one L2 bridge with NAT to the internet. Every cluster node (controlplane, worker1, worker2, gpu-worker) gets an IP on `192.168.100.0/24`. This uniform L2 topology is required for Cilium native routing to work without VXLAN encapsulation.
- **GPU passthrough (VFIO/IOMMU):** the RTX 5060 Ti (dGPU) is passed through to the `gpu-worker` VM via PCIe passthrough — the host never uses the dGPU directly. The host retains the iGPU (AMD Radeon integrated in Ryzen 5 9600X) for the desktop environment. Using a VM with passthrough (instead of the host as a k8s node) keeps all nodes on the same bridge and avoids network asymmetry.
- **Cilium CNI:** full eBPF networking. kube-proxy is skipped — Cilium replaces it entirely.
- **Host NOT a k8s worker:** the host runs the desktop, manages VMs via libvirt, and serves as the kubectl client — but does not join the cluster. All GPU workloads run inside the `gpu-worker` VM via passthrough.
- **ArgoCD (App of Apps):** all post-bootstrap changes are driven by Git pushes to [`lespaul-argo_cd`](https://github.com/huynhthientung/lespaul-argo_cd).

> **Memory note:** 32 GB is fully committed across 7 VMs + desktop. worker1/worker2 are reduced to 4 GB each (from 6 GB) to make room for the `docker-builder` VM. If OOM occurs, reduce jenkins-master to 2 GB.

---

## 2. Phase 1: Install Ubuntu Desktop (Dual Boot)

### 2.1 Preparation (in Windows)

1. Download Ubuntu 24.04 LTS Desktop ISO from [ubuntu.com](https://ubuntu.com).
2. Create a bootable USB with Rufus or Balena Etcher.
3. Disable **Fast Startup**: Control Panel → Power Options → Choose what the power buttons do → uncheck "Turn on fast startup".
4. Disable **BitLocker** if enabled: Settings → Privacy & Security → Device encryption.
5. Shrink the Windows partition: open Disk Management, right-click the main partition → Shrink Volume. Free at least **300 GB** for Ubuntu.

> **Back up important data before modifying partitions.**

### 2.2 Install Ubuntu

1. Boot from USB (press F2/F12/DEL for boot menu).
2. Select "Install Ubuntu" → "Install Ubuntu alongside Windows Boot Manager".
3. Recommended partition layout: 512 MB `/boot/efi`, remainder as ext4 at `/`. Use a swap **file** (not a partition) — configured post-install.
4. Complete installation and reboot. GRUB will show both Ubuntu and Windows.

### 2.3 Post-Install Basics

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y build-essential curl wget git htop net-tools
```

> **Monitor connection:** plug your display into the **motherboard** video output (HDMI/DisplayPort on the back I/O panel), not the GPU. The GPU will be passed to `gpu-worker` in Phase 2 and will no longer drive the desktop.

---

## 3. Phase 2: Enable IOMMU & Configure GPU Passthrough (VFIO)

GPU passthrough lets the `gpu-worker` VM exclusively own the RTX 5060 Ti. The host uses the AMD Ryzen 5 9600X's integrated Radeon GPU for the desktop from this point on.

> **BIOS first:** enter UEFI/BIOS and enable **AMD-Vi (IOMMU)** — usually under Advanced → CPU Configuration or AMD CBS → NBIO Common Options. Save and reboot into Ubuntu.

### 3.1 🖥️ [HOST] Enable IOMMU in GRUB

```bash
sudo nano /etc/default/grub
# Change GRUB_CMDLINE_LINUX_DEFAULT to:
# GRUB_CMDLINE_LINUX_DEFAULT="quiet splash amd_iommu=on iommu=pt"

sudo update-grub
sudo reboot
```

Verify after reboot:

```bash
dmesg | grep -i iommu | head -20
# Look for: AMD-Vi: IOMMU enabled  or  pci 0000:00:00.2: AMD-Vi: IOMMU performance
```

### 3.2 🖥️ [HOST] Find GPU IOMMU Group & PCI IDs

```bash
# List all devices with their IOMMU group numbers
for d in /sys/kernel/iommu_groups/*/devices/*; do
  n=${d#*/iommu_groups/*}; n=${n%%/*}
  printf 'IOMMU Group %s ' "$n"
  lspci -nns "${d##*/}"
done | grep -i nvidia
```

Example output:
```
IOMMU Group 14 01:00.0 VGA compatible controller [0300]: NVIDIA ... RTX 5060 Ti [10de:XXXX]
IOMMU Group 14 01:00.1 Audio device [0403]: NVIDIA ... HD Audio [10de:YYYY]
```

Note the **PCI slot** (`01:00.0`, `01:00.1`) and the **vendor:device IDs** (`10de:XXXX`, `10de:YYYY`).

> **All devices in the same IOMMU group must be passed through together.** If the GPU shares a group with unrelated devices, consider ACS override patches (advanced — out of scope here).

### 3.3 🖥️ [HOST] Bind RTX 5060 Ti to vfio-pci

Replace `10de:XXXX,10de:YYYY` with your actual GPU + HDMI audio PCI IDs from Step 3.2.

```bash
cat <<EOF | sudo tee /etc/modprobe.d/vfio.conf
options vfio-pci ids=10de:XXXX,10de:YYYY
softdep nouveau pre: vfio-pci
softdep nvidia pre: vfio-pci
EOF

cat <<EOF | sudo tee /etc/modules-load.d/vfio.conf
vfio
vfio_iommu_type1
vfio_pci
EOF

sudo update-initramfs -u -k all
sudo reboot
```

### 3.4 🖥️ [HOST] Verify VFIO Binding

```bash
lspci -nnk | grep -A3 -i nvidia
# "Kernel driver in use: vfio-pci"  ← GPU is claimed by VFIO — correct
# If it still shows "nvidia" or "nouveau", the softdep didn't apply — check /etc/modprobe.d/vfio.conf
```

The GPU is now unavailable to the host OS and ready for VM passthrough.

---

## 4. Phase 3: Install KVM/QEMU & Libvirt

### 4.1 Verify Virtualization Support

```bash
egrep -c '(vmx|svm)' /proc/cpuinfo   # should be > 0
sudo apt install -y cpu-checker
kvm-ok                                 # should say: KVM acceleration can be used
```

### 4.2 Install Packages

```bash
sudo apt install -y qemu-kvm libvirt-daemon-system \
  libvirt-clients bridge-utils virt-manager virtinst

sudo usermod -aG libvirt $USER
sudo usermod -aG kvm $USER
# Log out and back in for group changes to take effect
```

### 4.3 Verify

```bash
virsh list --all
sudo systemctl status libvirtd   # should be active (running)
```

---

## 5. Phase 4: Setup Bridge Network

The bridge `br-k8s` (`192.168.100.0/24`) connects all VMs and the host on the same subnet with NAT out to the internet.

> First identify your physical NIC: `ip a` or `nmcli device status`. Common names: `enp4s0`, `enp5s0`, `eno1`. Replace accordingly below.

### 5.1 Option A: Netplan

```yaml
# /etc/netplan/01-bridge.yaml
network:
  version: 2
  ethernets:
    enp4s0:       # your physical NIC
      dhcp4: false
  bridges:
    br-k8s:
      interfaces: [enp4s0]
      addresses: [192.168.100.1/24]
      parameters:
        stp: false
      dhcp4: false
      mtu: 1500
```

```bash
sudo netplan apply
ip addr show br-k8s
bridge link
```

Enable NAT (internet access for VMs):

```bash
# Persist in /etc/rc.local or a systemd unit
sudo iptables -t nat -A POSTROUTING -s 192.168.100.0/24 ! -d 192.168.100.0/24 -j MASQUERADE
echo 1 | sudo tee /proc/sys/net/ipv4/ip_forward
```

### 5.2 Option B: NetworkManager

```bash
sudo nmcli connection add type bridge ifname br-k8s con-name br-k8s
sudo nmcli connection add type bridge-slave ifname enp4s0 master br-k8s
sudo nmcli connection modify br-k8s ipv4.addresses 192.168.100.1/24 ipv4.method manual
sudo nmcli connection down 'Wired connection 1'
sudo nmcli connection up br-k8s
```

> **WiFi bridge is not supported.** Use Ethernet for this setup.

---

## 6. Phase 5: Create Virtual Machines

### 6.1 Download Ubuntu Server ISO

```bash
cd /var/lib/libvirt/images/
sudo wget https://releases.ubuntu.com/24.04/ubuntu-24.04-live-server-amd64.iso
```

### 6.2 Create VM Disks

```bash
sudo qemu-img create -f qcow2 /var/lib/libvirt/images/controlplane.qcow2         30G
sudo qemu-img create -f qcow2 /var/lib/libvirt/images/worker1.qcow2     40G
sudo qemu-img create -f qcow2 /var/lib/libvirt/images/worker2.qcow2     40G
sudo qemu-img create -f qcow2 /var/lib/libvirt/images/gpu-worker.qcow2  60G
sudo qemu-img create -f qcow2 /var/lib/libvirt/images/jenkins.qcow2     50G
```

### 6.3 Create VMs

Control plane:

```bash
virt-install \
  --name controlplane --ram 4096 --vcpus 2 \
  --disk path=/var/lib/libvirt/images/controlplane.qcow2,format=qcow2 \
  --os-variant ubuntu24.04 \
  --network bridge=br-k8s,model=virtio \
  --cdrom /var/lib/libvirt/images/ubuntu-24.04-live-server-amd64.iso \
  --graphics vnc,listen=0.0.0.0 --noautoconsole
```

Worker nodes (repeat for worker1, worker2 — adjust `--name` and `--disk`):

```bash
virt-install \
  --name worker1 --ram 6144 --vcpus 2 \
  --disk path=/var/lib/libvirt/images/worker1.qcow2,format=qcow2 \
  --os-variant ubuntu24.04 \
  --network bridge=br-k8s,model=virtio \
  --cdrom /var/lib/libvirt/images/ubuntu-24.04-live-server-amd64.iso \
  --graphics vnc,listen=0.0.0.0 --noautoconsole
```

gpu-worker (PCIe passthrough — adjust `01:00.0` / `01:00.1` to your GPU's PCI slot from Phase 2):

```bash
virt-install \
  --name gpu-worker --ram 8192 --vcpus 4 \
  --disk path=/var/lib/libvirt/images/gpu-worker.qcow2,format=qcow2 \
  --os-variant ubuntu24.04 \
  --network bridge=br-k8s,model=virtio \
  --cdrom /var/lib/libvirt/images/ubuntu-24.04-live-server-amd64.iso \
  --machine q35 \
  --boot uefi \
  --cpu host-passthrough \
  --features kvm_hidden=on \
  --hostdev 01:00.0 \
  --hostdev 01:00.1 \
  --graphics vnc,listen=0.0.0.0 --noautoconsole
```

> - `--network bridge=br-k8s` puts `gpu-worker` on the **same L2 bridge as all other VMs** — essential for Cilium native routing. Do not use the default `virbr0` (NAT network) or host networking here.
> - `--machine q35` is required for PCIe passthrough.
> - `--cpu host-passthrough` exposes real CPU features to the VM (required by NVIDIA drivers). This is CPU feature exposure only — the GPU is passed through via `--hostdev`, not via the host OS.
> - `kvm_hidden=on` prevents NVIDIA Error 43 caused by the driver detecting it's running inside a hypervisor.
> - `--hostdev 01:00.1` passes the GPU's HDMI audio device — required because GPU and audio share the same IOMMU group.

### 6.4 Post-Install VM Configuration

Set static IPs on each VM via Netplan:

```yaml
# /etc/netplan/00-installer-config.yaml  (example for controlplane)
network:
  version: 2
  ethernets:
    enp1s0:
      addresses: [192.168.100.200/24]
      routes:
        - to: default
          via: 192.168.100.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
```

| Node | IP | Hostname |
|------|----|---------|
| Host | 192.168.100.1 | k8s-host |
| controlplane | 192.168.100.200 | controlplane |
| worker1 | 192.168.100.201 | worker1 |
| worker2 | 192.168.100.202 | worker2 |
| gpu-worker | 192.168.100.210 | gpu-worker |
| jenkins-master | 192.168.100.170 | jenkins-master |
| docker-builder | 192.168.100.171 | docker-builder |
| nfs-server | 192.168.100.180 | nfs-server |

Add to `/etc/hosts` on **all nodes**:

```
192.168.100.1   k8s-host
192.168.100.200 controlplane
192.168.100.201 worker1
192.168.100.202 worker2
192.168.100.210 gpu-worker
192.168.100.170 jenkins-master
192.168.100.171 docker-builder
192.168.100.180 nfs-server
```

### 6.5 Setup SSH Access

```bash
# On host
ssh-keygen -t ed25519
ssh-copy-id ubuntu@192.168.100.200
ssh-copy-id ubuntu@192.168.100.201
ssh-copy-id ubuntu@192.168.100.202
ssh-copy-id ubuntu@192.168.100.210
ssh-copy-id ubuntu@192.168.100.170
ssh-copy-id ubuntu@192.168.100.171
ssh-copy-id ubuntu@192.168.100.180
```

### 6.6 Create NFS Server VM

The NFS server is a lightweight dedicated VM that provides persistent storage for the Kubernetes cluster via the `nfs-client` StorageClass.

```bash
sudo qemu-img create -f qcow2 /var/lib/libvirt/images/nfs-server.qcow2 100G

virt-install \
  --name nfs-server \
  --ram 1024 --vcpus 1 \
  --disk path=/var/lib/libvirt/images/nfs-server.qcow2,format=qcow2 \
  --os-variant ubuntu24.04 \
  --network bridge=br-k8s,model=virtio \
  --cdrom /var/lib/libvirt/images/ubuntu-24.04-live-server-amd64.iso \
  --graphics vnc,listen=0.0.0.0 --noautoconsole
```

Set static IP after Ubuntu Server install:

```yaml
# /etc/netplan/00-installer-config.yaml on the nfs-server VM
network:
  version: 2
  ethernets:
    enp1s0:
      addresses: [192.168.100.180/24]
      routes:
        - to: default
          via: 192.168.100.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
```

```bash
sudo netplan apply
```

Add to `/etc/hosts` on **all nodes**:

```
192.168.100.180 nfs-server
```

Auto-start with the other VMs:

```bash
virsh autostart nfs-server
```

---

## 6.7 Configure NFS Server

All commands run **on the nfs-server VM** (`192.168.100.180`).

### Install NFS

```bash
sudo apt update
sudo apt install -y nfs-kernel-server
```

### Create export directory

```bash
sudo mkdir -p /srv/nfs/k8s
sudo chown nobody:nogroup /srv/nfs/k8s
sudo chmod 777 /srv/nfs/k8s
```

### Configure exports

```bash
echo '/srv/nfs/k8s 192.168.100.0/24(rw,sync,no_subtree_check,no_root_squash)' | \
  sudo tee -a /etc/exports

sudo exportfs -rav
sudo systemctl enable --now nfs-kernel-server
```

### Verify from host

```bash
showmount -e 192.168.100.180
# Expected:
# Export list for 192.168.100.180:
# /srv/nfs/k8s 192.168.100.0/24
```

### Install NFS client on all Kubernetes nodes

NFS client packages must be present on every node that will mount NFS volumes:

```bash
# Run on controlplane, worker1, worker2, and gpu-worker
sudo apt install -y nfs-common
```

---

## 7. Phase 6: Install Kubernetes (kubeadm)

### 7.1 🌐 [ALL NODES] Kernel Modules & Sysctl

```bash
cat <<EOF | sudo tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF

sudo modprobe overlay
sudo modprobe br_netfilter

cat <<EOF | sudo tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF

sudo sysctl --system
```

### 7.2 👷🎛️🎮 [controlplane, worker1, worker2, gpu-worker] Disable Swap

> **Do NOT run on the host.** The host is not a k8s node.

```bash
sudo swapoff -a
sudo sed -i '/swap/d' /etc/fstab
```

### 7.3 🌐 [ALL NODES] Install containerd

```bash
sudo apt install -y containerd
sudo mkdir -p /etc/containerd
containerd config default | sudo tee /etc/containerd/config.toml

# SystemdCgroup is required
sudo sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml

sudo systemctl restart containerd
sudo systemctl enable containerd
```

### 7.4 🌐 [ALL NODES] Install kubeadm, kubelet, kubectl

```bash
sudo apt-get install -y apt-transport-https ca-certificates curl gpg

curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.31/deb/Release.key | \
  sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg

echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] \
  https://pkgs.k8s.io/core:/stable:/v1.31/deb/ /' | \
  sudo tee /etc/apt/sources.list.d/kubernetes.list

sudo apt-get update
sudo apt-get install -y kubelet kubeadm kubectl
sudo apt-mark hold kubelet kubeadm kubectl
```

### 7.5 🎛️ [controlplane] Initialize Control Plane

```bash
sudo kubeadm init \
  --control-plane-endpoint=192.168.100.200 \
  --pod-network-cidr=10.0.0.0/16 \
  --skip-phases=addon/kube-proxy     # Cilium replaces kube-proxy

mkdir -p $HOME/.kube
sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
sudo chown $(id -u):$(id -g) $HOME/.kube/config
```

> Save the `kubeadm join ...` command printed at the end.

### 7.6 👷 [worker1, worker2] Join Workers

```bash
sudo kubeadm join 192.168.100.200:6443 \
  --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash>

# Lost the token? Regenerate on controlplane:
kubeadm token create --print-join-command
```

### 7.7 🧑‍💼 [kubectl client] Copy kubeconfig to Host

```bash
mkdir -p ~/.kube
scp ubuntu@192.168.100.200:~/.kube/config ~/.kube/config
kubectl get nodes
# controlplane Ready, worker1/worker2 NotReady (no CNI yet) — expected
# gpu-worker joins in Phase 8
```

---

## 8. Phase 7: Install Cilium CNI (Native Routing)

Cilium must run **before** ArgoCD can schedule pods. Bootstrap with Helm using the same `system/cilium/values.yaml` — ArgoCD adopts the release later without conflict.

This setup uses **native routing** (no VXLAN encapsulation). Pod packets travel with their real source IPs. All nodes are VMs on the same `br-k8s` L2 bridge — the host is not a cluster node and is never in the pod forwarding path.

### 8.1 👷🎛️🎮 [ALL VMs] Disable rp_filter

Native mode routes pod packets (e.g. `10.0.1.5`) across nodes via the VM NIC (`enp1s0`). The kernel's reverse-path filter drops these by default because the source IP isn't reachable on the incoming interface.

```bash
# Persist on each VM (controlplane, worker1, worker2, gpu-worker)
cat <<EOF | sudo tee /etc/sysctl.d/99-cilium-native.conf
net.ipv4.conf.all.rp_filter = 0
net.ipv4.conf.default.rp_filter = 0
net.ipv4.conf.enp1s0.rp_filter = 0
EOF

sudo sysctl --system
```

### 8.2 🖥️ [HOST] Check libvirt nwfilter

libvirt's `clean-traffic` filter drops packets whose source IP doesn't match the VM's assigned IP — which breaks pod traffic.

```bash
for vm in controlplane worker1 worker2 gpu-worker; do
  echo "=== $vm ===" && sudo virsh dumpxml $vm | grep filterref
done
```

If any VM shows `<filterref filter='clean-traffic'/>`, remove it:

```bash
sudo virsh edit controlplane   # delete the <filterref .../> line, repeat per VM
sudo virsh shutdown controlplane && sleep 10 && sudo virsh start controlplane
```

### 8.3 🧑‍💼 [kubectl client] Commit values.yaml then bootstrap

The `system/cilium/values.yaml` is already configured for native routing. Update `k8sServiceHost` to match your actual controlplane IP, then commit before bootstrapping so ArgoCD won't revert it:

```bash
# In the repo root
sed -i 's/k8sServiceHost:.*/k8sServiceHost: 192.168.100.200/' system/cilium/values.yaml

git add system/cilium/values.yaml
git commit -m "Set Cilium k8sServiceHost for this cluster"
git push
```

Bootstrap with Helm:

```bash
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

helm repo add cilium https://helm.cilium.io/
helm repo update

helm install cilium cilium/cilium \
  --version 1.19.3 \
  --namespace kube-system \
  -f system/cilium/values.yaml

kubectl -n kube-system rollout status ds/cilium --timeout=5m
kubectl get nodes   # all nodes should be Ready
```

> **ArgoCD adoption note:** `argocd/applications/system/cilium.yaml` uses `selfHeal: false` and `prune: false` intentionally — the CNI must never be automatically torn down by a GitOps sync. ArgoCD will reconcile config drift but will not restart or delete Cilium resources without manual approval.

### 8.4 Verify

> **Note (Cilium 1.16+):** the `cilium` binary inside the DaemonSet pod was renamed to `cilium-dbg`. Use `cilium-dbg` for all `kubectl exec` commands — `cilium` will not be found.

```bash
# Routing mode must show "Native"
kubectl -n kube-system exec ds/cilium -- cilium-dbg status --brief | grep -E "Routing|KubeProxy"

# Each node must have routes to the other nodes' pod CIDRs
ssh ubuntu@192.168.100.200 ip route | grep "10.0\."
# Expected: 10.0.x.0/24 via 192.168.100.2x dev enp1s0 per remote node

# Cross-node ping test
kubectl run test-a --image=nicolaka/netshoot --overrides='{"spec":{"nodeSelector":{"kubernetes.io/hostname":"worker1"}}}' -- sleep 300
kubectl run test-b --image=nicolaka/netshoot --overrides='{"spec":{"nodeSelector":{"kubernetes.io/hostname":"worker2"}}}' -- sleep 300
kubectl wait --for=condition=ready pod/test-a pod/test-b --timeout=60s
kubectl exec test-a -- ping -c 3 $(kubectl get pod test-b -o jsonpath='{.status.podIP}')
kubectl delete pod test-a test-b
```

> **Rollback to tunnel mode** if native is not working after debugging:
> In `system/cilium/values.yaml` replace `routingMode: native` with `routingMode: tunnel` + `tunnelProtocol: vxlan`, remove `ipv4NativeRoutingCIDR` and `autoDirectNodeRoutes`, then push and restart the agent.

---

## 9. Phase 8: Join gpu-worker VM as GPU Worker Node

The `gpu-worker` VM has the RTX 5060 Ti passed through from the host. It joins the cluster as the dedicated GPU node.

### 9.1 🎮 [gpu-worker] Install NVIDIA Drivers

Inside the `gpu-worker` VM the GPU appears as a standard PCI device:

```bash
lspci | grep -i nvidia
# Should show: RTX 5060 Ti (VGA compatible controller)

# Check available drivers
ubuntu-drivers devices

# Install recommended driver (560+ required for RTX 5060 Ti)
sudo apt install -y nvidia-driver-560

sudo reboot
```

### 9.2 🎮 [gpu-worker] Verify GPU

```bash
nvidia-smi
# Should show RTX 5060 Ti, 16 GB VRAM, driver version, CUDA version
```

> If `nvidia-smi` fails with Error 43, confirm `kvm_hidden=on` is set in the VM XML (`virsh edit gpu-worker`) and that the `softdep` lines in `/etc/modprobe.d/vfio.conf` on the **host** are correct.

### 9.3 🎮 [gpu-worker] Join Cluster

```bash
sudo kubeadm join 192.168.100.200:6443 \
  --token <token> \
  --discovery-token-ca-cert-hash sha256:<hash>

# Lost the token? Regenerate on controlplane:
# kubeadm token create --print-join-command
```

### 9.4 🧑‍💼 [kubectl client] Label & Taint gpu-worker

```bash
kubectl label nodes gpu-worker \
  node-role.kubernetes.io/gpu-worker="" \
  nvidia.com/gpu=present \
  workload-type=gpu

# Optional: prevent non-GPU workloads from scheduling on gpu-worker
kubectl taint nodes gpu-worker gpu=true:NoSchedule
```

---

## 10. Phase 9: NVIDIA Container Toolkit

### 10.1 🎮 [gpu-worker] Install Toolkit

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit

sudo nvidia-ctk runtime configure --runtime=containerd --set-as-default
sudo systemctl restart containerd
```

> **Note:** `nvidia-ctk runtime configure` writes to `/etc/containerd/conf.d/99-nvidia.toml`, not the main `config.toml`. The containerd default config includes `imports = ["/etc/containerd/conf.d/*.toml"]`, so the drop-in is loaded automatically after restart. Verify with:
> ```bash
> grep -r "nvidia" /etc/containerd/
> sudo systemctl status containerd
> ```

The NVIDIA device plugin is deployed via ArgoCD in Phase 10.5 — no manual `kubectl apply` needed.

---

## 11. Phase 10: ArgoCD — GitOps with lespaul-argo_cd

The repo uses the **App of Apps** pattern. Four parent Applications each watch a directory of child Application manifests:

```
system-apps  →  argocd/applications/system/  →  cilium, nfs-provisioner, nvidia-device-plugin
common-apps  →  argocd/applications/common/  →  common-config
                                                  ├── common/argocd/   (argocd-cm, git-token, webhook-secret)
                                                  └── common/cloudflare/ (cloudflared namespace, configmap, deployment)
dev-apps     →  argocd/applications/dev/     →  dev-config
prod-apps    →  argocd/applications/prod/    →  prod-config
```

### 10.1 🧑‍💼 Install ArgoCD

```bash
kubectl create namespace argocd
kubectl apply -n argocd \
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

kubectl wait --for=condition=available --timeout=300s \
  deployment --all -n argocd
```

### 10.2 🧑‍💼 Access the UI

```bash
kubectl port-forward svc/argocd-server -n argocd 8080:80 &

kubectl -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath="{.data.password}" | base64 -d; echo
```

Open `https://localhost:8080`, login with `admin` / password above.

### 10.3 🧑‍💼 Add Repository Credentials

The repo is private — ArgoCD needs a Personal Access Token (PAT):

```bash
kubectl -n argocd create secret generic repo-private-github \
  --from-literal=type=git \
  --from-literal=url=https://github.com/huynhthientung/lespaul-argo_cd.git \
  --from-literal=username=huynhthientung \
  --from-literal=password=<YOUR_GITHUB_PAT>

kubectl -n argocd label secret repo-private-github \
  argocd.argoproj.io/secret-type=repository
```

> This is managed as a GitOps resource at `common/argocd-git-token-config.yaml` after bootstrap.

### 10.4 🧑‍💼 Bootstrap — Apply the 4 App-of-Apps

Apply system first so Cilium adoption completes before other apps start:

```bash
cd lespaul-argo_cd

kubectl apply -f argocd/app-of-apps/system-apps.yaml
kubectl apply -f argocd/app-of-apps/common-apps.yaml
kubectl apply -f argocd/app-of-apps/dev-apps.yaml
kubectl apply -f argocd/app-of-apps/prod-apps.yaml

kubectl get applications -n argocd
```

Expected output:

```
NAME                    SYNC STATUS   HEALTH STATUS
system-apps             Synced        Healthy
common-apps             Synced        Healthy
dev-apps                Synced        Healthy
prod-apps               Synced        Healthy
cilium                  Synced        Healthy   ← adopts the Helm release from Phase 7
nfs-provisioner         Synced        Healthy
common-config           Synced        Healthy
dev-config              Synced        Healthy
prod-config             Synced        Healthy
```

> `nvidia-device-plugin` does not appear yet — it is added in Phase 10.5 by committing its Application manifest.

From this point: **push Git → ArgoCD syncs automatically.**

### 10.5 NVIDIA Device Plugin via ArgoCD

Create `argocd/applications/system/nvidia-device-plugin.yaml`:

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: nvidia-device-plugin
  namespace: argocd
  finalizers:
    - resources-finalizer.argocd.argoproj.io
spec:
  project: default
  source:
    repoURL: https://nvidia.github.io/k8s-device-plugin
    chart: nvidia-device-plugin
    targetRevision: 0.19.1
    helm:
      releaseName: nvidia-device-plugin
      values: |
        nvidiaDriverRoot: "/"
        securityContext:
          privileged: true
        affinity:
          nodeAffinity:
            requiredDuringSchedulingIgnoredDuringExecution:
              nodeSelectorTerms:
                - matchExpressions:
                    - key: nvidia.com/gpu
                      operator: In
                      values:
                        - present
        nodeSelector:
          nvidia.com/gpu: present
        tolerations:
          - key: "gpu"
            operator: "Equal"
            value: "true"
            effect: "NoSchedule"
  destination:
    server: https://kubernetes.default.svc
    namespace: kube-system
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=false
      - ServerSideApply=true
```

> **Why these extra values?**
> - `affinity` — The chart's default `nodeAffinity` requires Node Feature Discovery (NFD) labels (`feature.node.kubernetes.io/pci-10de.present`, etc.) that are not present without NFD running. This override replaces it with a matcher for the `nvidia.com/gpu=present` label that was manually applied to the node. Without this, the DaemonSet has `DESIRED: 0` and no pods are ever scheduled.
> - `nvidiaDriverRoot: "/"` — Mounts the host root filesystem at `/driver-root` inside the container, making `libnvidia-ml.so` visible. Without this, the plugin fails with `ERROR_LIBRARY_NOT_FOUND`.
> - `securityContext.privileged: true` — Grants the container access to `/dev/nvidiactl` and `/dev/nvidia0`. Without this, NVML initializes the library but cannot open the kernel device, failing with `Driver Not Loaded`.

Commit and push — `system-apps` auto-discovers the file and deploys the DaemonSet.

```bash
kubectl get applications -n argocd nvidia-device-plugin
kubectl describe node gpu-worker | grep nvidia.com/gpu
# Expected: nvidia.com/gpu: 1
```

### 10.6 NFS Storage Provisioner

The `nfs-client` StorageClass provides `ReadWriteMany` persistent volumes backed by an NFS server at `192.168.100.180:/srv/nfs/k8s`.

> **Pre-requisite — `nfs-common` on every node.** The provisioner mounts the NFS share directly via the kernel NFS client. Without `nfs-common` the mount fails with `bad option / mount.<type> helper program` error.
>
> ```bash
> # Run on controlplane, worker1, worker2, gpu-worker
> for node in 192.168.100.200 192.168.100.201 192.168.100.202 192.168.100.210; do
>   ssh ubuntu@$node "sudo apt install -y nfs-common"
> done
> ```

Bootstrap (one-time, before ArgoCD adoption):

```bash
helm repo add nfs-subdir-external-provisioner \
  https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/

helm install nfs-provisioner \
  nfs-subdir-external-provisioner/nfs-subdir-external-provisioner \
  --version 4.0.18 \
  --namespace nfs-provisioner --create-namespace \
  --set nfs.server=192.168.100.180 \
  --set nfs.path=/srv/nfs/k8s \
  --set storageClass.name=nfs-client \
  --set storageClass.defaultClass=false \
  --set storageClass.accessModes=ReadWriteMany
```

ArgoCD takes over via `argocd/applications/system/nfs-provisioner.yaml`. To hand off ownership:

```bash
helm uninstall nfs-provisioner -n nfs-provisioner
# ArgoCD recreates it from system/nfs-provisioner/values.yaml
```

> **Do not scale PostgreSQL beyond 1 replica.** Multiple Postgres processes sharing the same NFS data directory causes corruption. Use [CloudNativePG](https://cloudnative-pg.io/) for HA.

### 10.7 Cloudflared — Expose ArgoCD via Cloudflare Tunnel

Cloudflared creates a secure outbound-only tunnel from the cluster to Cloudflare, making `cd.huynhthientung.com` publicly accessible without opening any inbound ports or running ngrok.

**Manifests:**
- `common/cloudflare/cloudflared-configs.yaml` — Namespace + ConfigMap
- `common/cloudflare/cloudflared-deployment.yaml` — Deployment (2 replicas)

The `common-config` Application watches `common/` with `recurse: true`, so subdirectories are picked up automatically — no new ArgoCD Application needed.

**Step 1 — Create the credentials Secret (one-time, manual)**

The tunnel JSON credentials are sensitive and must not be committed to Git:

```bash
kubectl create namespace cloudflared

kubectl create secret generic tunnel-credentials \
  --from-file=credentials.json=/home/tung/.cloudflared/6a222aeb-5337-4d4e-82ac-e78195a7e636.json \
  -n cloudflared
```

**Step 2 — Push `common/cloudflared.yaml` to Git**

ArgoCD (`common-config`) will detect the new file and deploy the ConfigMap and Deployment within 30 s (or on the next poll cycle).

**Verify:**

```bash
kubectl get pods -n cloudflared
# NAME                           READY   STATUS    RESTARTS
# cloudflared-XXXX               1/1     Running   0
# cloudflared-YYYY               1/1     Running   0

# Check tunnel is connected:
kubectl logs -n cloudflared -l app=cloudflared | grep "Registered tunnel connection"
```

Once both pods show `Running`, `https://cd.huynhthientung.com` is live.

> **Note:** if ArgoCD shows the Deployment as `OutOfSync` with a namespace error, confirm the `tunnel-credentials` Secret was created in the `cloudflared` namespace before the sync ran. ArgoCD cannot create the Secret — it must exist first.

---

### 10.8 Adding New Applications (Workflow)

| App type | Where to add |
|----------|-------------|
| System infra (ingress, monitoring, etc.) | `argocd/applications/system/` + values in `system/<app>/` |
| Shared resources (cross-env secrets/configmaps) | `common/` |
| Dev workloads | `dev/` |
| Prod workloads | `prod/` |

Push the commit — ArgoCD syncs within 30 s (webhook) or 3 min (polling).

---

## 12. Phase 11: Verification & Testing

### 12.1 Cluster Status

```bash
kubectl get nodes -o wide          # all nodes Ready
kubectl get pods -n kube-system    # all system pods Running
kubectl get applications -n argocd # all apps Synced + Healthy
```

### 12.2 Test GPU Workload

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: gpu-test
  namespace: default
spec:
  restartPolicy: Never
  nodeSelector:
    nvidia.com/gpu: present
  tolerations:
    - key: "gpu"
      operator: "Equal"
      value: "true"
      effect: "NoSchedule"
  containers:
    - name: cuda-test
      image: nvidia/cuda:12.4.0-runtime-ubuntu22.04
      command: ["nvidia-smi"]
      resources:
        limits:
          nvidia.com/gpu: 1
EOF

kubectl logs gpu-test   # should show RTX 5060 Ti, 16 GB VRAM on gpu-worker
kubectl get pod gpu-test -o wide  # NODE column should show gpu-worker
kubectl delete pod gpu-test
```

### 12.3 Test Network Connectivity

```bash
kubectl create deployment nginx --image=nginx --replicas=3
kubectl expose deployment nginx --port=80 --type=NodePort
kubectl get pods -o wide   # pods spread across nodes

NODE_PORT=$(kubectl get svc nginx -o jsonpath='{.spec.ports[0].nodePort}')
curl http://192.168.100.201:$NODE_PORT

kubectl delete deployment nginx
kubectl delete svc nginx
```

---

## 13. Phase 12: Jenkins Kubernetes Agent (Dynamic Pod Agents)

Jenkins master runs on a dedicated VM (`192.168.100.170`, exposed at `https://ci.huynhthientung.com`). This phase configures it to dynamically spin up agent pods inside the Kubernetes cluster for each build, then delete them when the build finishes.

> **Why Kubernetes agents instead of a static VM agent?**
> Each build gets a clean, isolated pod. No leftover state between builds. Agents scale to zero when idle — no wasted resources. Different pod templates provide different toolchains (maven, node, docker-in-docker, etc.) without managing multiple VMs.

### 13.1 Architecture

```
Internet
   │
   ▼
ci.huynhthientung.com  (Cloudflare → jenkins-master VM 192.168.100.170)
   │
   │  1. Kubernetes plugin calls K8s API to create agent pod
   ▼
K8s API Server (192.168.100.200:6443)
   │
   │  2. Pod starts on worker1/worker2, runs JNLP inbound agent
   ▼
jenkins-agent pod (namespace: jenkins)
   │
   │  3. Agent connects back to Jenkins master via internal IP
   ▼
jenkins-master (192.168.100.170:50000)  ← JNLP port
```

Agent pods reach Jenkins master via the internal bridge network (`192.168.100.170`), not through the public URL — no extra firewall rules needed.

---

### 13.2 Install Jenkins Kubernetes Plugin

In the Jenkins UI (`https://ci.huynhthientung.com`):

1. **Manage Jenkins** → **Plugins** → **Available plugins**
2. Search for **Kubernetes** → install **Kubernetes** (by Carlos Sanchez)
3. Also install **Kubernetes Client API** if not already present (it's a dependency — usually auto-selected)
4. Restart Jenkins when prompted

Verify after restart: **Manage Jenkins** → **Clouds** — "Kubernetes" should now appear as an option.

---

### 13.3 Create Kubernetes Namespace & RBAC

Jenkins master needs permission to create/delete pods and read secrets in the `jenkins` namespace.

Run on the **kubectl client (host)**:

```bash
kubectl create namespace jenkins
```

Create the ServiceAccount and RBAC:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ServiceAccount
metadata:
  name: jenkins
  namespace: jenkins
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: jenkins-agent
  namespace: jenkins
rules:
  - apiGroups: [""]
    resources: ["pods", "pods/exec", "pods/log", "secrets", "configmaps"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: jenkins-agent
  namespace: jenkins
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: jenkins-agent
subjects:
  - kind: ServiceAccount
    name: jenkins
    namespace: jenkins
EOF
```

Create a long-lived token Secret (K8s 1.24+) and retrieve it:

```bash
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: jenkins-token
  namespace: jenkins
  annotations:
    kubernetes.io/service-account.name: jenkins
type: kubernetes.io/service-account-token
EOF

# Wait a moment for the token to be populated, then read it
kubectl -n jenkins get secret jenkins-token \
  -o jsonpath='{.data.token}' | base64 -d; echo
```

Copy this token — you will paste it into Jenkins in the next step.

---

### 13.4 Add K8s Credentials in Jenkins

1. **Manage Jenkins** → **Credentials** → **System** → **Global credentials** → **Add Credentials**
2. Fill in:
   - **Kind:** Secret text
   - **Secret:** paste the token from Step 13.3
   - **ID:** `k8s-jenkins-sa-token`
   - **Description:** Jenkins ServiceAccount token for K8s

---

### 13.5 Configure the Kubernetes Cloud in Jenkins

1. **Manage Jenkins** → **Clouds** → **New cloud** → select **Kubernetes** → click **Create**
2. Fill in the cloud settings:

| Field | Value |
|-------|-------|
| **Name** | `kubernetes` |
| **Kubernetes URL** | `https://192.168.100.200:6443` |
| **Kubernetes server certificate key** | paste cluster CA (see below) |
| **Credentials** | `k8s-jenkins-sa-token` |
| **Jenkins URL** | `http://192.168.100.170:8080` |
| **Jenkins tunnel** | `192.168.100.170:50000` |
| **Namespace** | `jenkins` |
| **Connection Timeout** | `30` |
| **Read Timeout** | `30` |

> **Why the internal IP and not `https://ci.huynhthientung.com`?**
>
> Jenkins is publicly exposed via **Cloudflare Tunnel** (cloudflared), which only proxies HTTP/HTTPS on ports 80/443. The JNLP agent protocol uses a raw **TCP** connection on port 50000 — Cloudflare cannot proxy this. Agent pods must therefore connect back to the Jenkins master using a directly reachable address.
>
> Since agent pods run inside the cluster on the same `192.168.100.0/24` bridge as `jenkins-master`, the internal IP `192.168.100.170` is always reachable and is the right choice.
>
> **Alternative — WebSocket mode (no port 50000 needed):**
> If you later need external agents (outside the cluster) to connect via the public URL, enable WebSocket support:
> 1. **Manage Jenkins** → **Security** → **Agents** → check **Enable WebSocket** → Save
> 2. Set **Jenkins URL** to `https://ci.huynhthientung.com` and leave **Jenkins tunnel** blank
> 3. Add env var `JNLP_PROTOCOL_OPTS=-webSocket` to each pod template
>
> WebSocket runs over HTTPS/443 which Cloudflare does proxy (`wss://ci.huynhthientung.com`). For this lab, internal IP is simpler and sufficient.

Get the cluster CA certificate:

```bash
kubectl config view --raw \
  -o jsonpath='{.clusters[0].cluster.certificate-authority-data}' | base64 -d
```

Paste the full PEM block (including `-----BEGIN CERTIFICATE-----` / `-----END CERTIFICATE-----`) into **Kubernetes server certificate key**.

Click **Test Connection** — you should see `Connected to Kubernetes vX.XX`.

> **Tip:** For the lab, you can check **Disable https certificate check** instead of managing the CA cert manually. In production always verify the cert.

---

### 13.6 Define a Pod Template

Still inside the Kubernetes cloud settings, scroll to **Pod Templates** → **Add a pod template**.

#### Default agent (JNLP)

| Field | Value |
|-------|-------|
| **Name** | `jenkins-agent` |
| **Labels** | `jenkins-agent` |
| **Namespace** | `jenkins` |
| **Service Account** | `jenkins` |

Add a container inside the template:

| Field | Value |
|-------|-------|
| **Name** | `jnlp` |
| **Docker image** | `jenkins/inbound-agent:latest` |
| **Working directory** | `/home/jenkins/agent` |
| **Command to run** | *(leave blank)* |
| **Arguments to pass** | *(leave blank)* |

Resource limits:

| Field | Value |
|-------|-------|
| **Request CPU** | `250m` |
| **Request Memory** | `256Mi` |
| **Limit CPU** | `500m` |
| **Limit Memory** | `512Mi` |

Click **Save**.

#### Optional: Maven agent template

Add a second pod template for Java/Maven builds:

| Field | Value |
|-------|-------|
| **Name** | `maven-agent` |
| **Labels** | `maven-agent` |

Add two containers in this template:

Container 1 — `jnlp`:

| Field | Value |
|-------|-------|
| **Name** | `jnlp` |
| **Docker image** | `jenkins/inbound-agent:latest` |
| **Command to run** | *(leave blank)* |

Container 2 — `maven`:

| Field | Value |
|-------|-------|
| **Name** | `maven` |
| **Docker image** | `maven:3.9-eclipse-temurin-21` |
| **Command to run** | `sleep` |
| **Arguments to pass** | `99d` |

---

### 13.7 Ensure JNLP Port is Open on Jenkins Master

Agent pods connect back to Jenkins on TCP port 50000.

```bash
# On jenkins-master VM — verify Jenkins is listening on 50000
sudo ss -tlnp | grep 50000
# Expected: LISTEN  0.0.0.0:50000
```

If nothing shows, enable the fixed port in Jenkins:

1. **Manage Jenkins** → **Security**
2. **Agents** section → **TCP port for inbound agents** → set to **Fixed: 50000**
3. Save

---

### 13.8 Test — Hello World Pipeline

Create a new **Pipeline** job in Jenkins and paste:

```groovy
pipeline {
    agent {
        kubernetes {
            label 'jenkins-agent'
            defaultContainer 'jnlp'
        }
    }
    stages {
        stage('Hello from K8s Pod') {
            steps {
                sh 'echo "Running on: $(hostname)"'
                sh 'cat /etc/os-release | grep PRETTY_NAME'
            }
        }
    }
}
```

Watch pod lifecycle while the build runs:

```bash
kubectl get pods -n jenkins -w
```

Expected: a pod appears → `Running` → build output shows → pod is deleted after the build.

---

### 13.9 Test — Maven Agent

```groovy
pipeline {
    agent {
        kubernetes {
            label 'maven-agent'
            defaultContainer 'maven'
        }
    }
    stages {
        stage('Maven Version') {
            steps {
                container('maven') {
                    sh 'mvn --version'
                    sh 'java --version'
                }
            }
        }
    }
}
```

---

### 13.10 Inline Pod YAML (Recommended for Real Pipelines)

Define the pod spec inline in your Jenkinsfile — it lives in version control alongside the code:

```groovy
pipeline {
    agent {
        kubernetes {
            yaml """
apiVersion: v1
kind: Pod
spec:
  serviceAccountName: jenkins
  containers:
    - name: jnlp
      image: jenkins/inbound-agent:latest
      resources:
        requests:
          cpu: 250m
          memory: 256Mi
        limits:
          cpu: 500m
          memory: 512Mi
    - name: maven
      image: maven:3.9-eclipse-temurin-21
      command: [sleep, 99d]
      resources:
        requests:
          cpu: 500m
          memory: 512Mi
        limits:
          cpu: '1'
          memory: 1Gi
"""
            defaultContainer 'maven'
        }
    }
    stages {
        stage('Build') {
            steps {
                sh 'mvn --version'
            }
        }
    }
}
```

---

### 13.11 Troubleshooting Jenkins K8s Agents

**Pod stays in `Pending`**

```bash
kubectl describe pod -n jenkins <pod-name>
# Check the Events section — usually insufficient CPU/memory, or nodeSelector mismatch
```

**Agent never connects (pod `Running` but Jenkins shows executor offline)**

- Verify **Jenkins tunnel** uses the internal IP `192.168.100.170:50000`, not the public domain
- Check agent pod logs: `kubectl logs -n jenkins <pod-name> -c jnlp`
- Look for `SSLHandshakeException` — agent image needs to trust the Jenkins master TLS cert

**`Test Connection` returns `Unauthorized`**

- Token may have expired or the wrong credential ID was used
- Recreate the token Secret and update the Jenkins credential

**Pod creates but immediately exits**

```bash
kubectl logs -n jenkins <pod-name>
# Common cause: custom 'command' set on the jnlp container — leave it blank
```

**Build hangs at "Waiting for next available executor"**

- The `label` in the Jenkinsfile must exactly match the **Labels** field in the pod template
- Check **Manage Jenkins** → **Clouds** — ensure the cloud is not disabled

---

### 13.12 Docker Builds inside Agent Pods

Running `docker build` inside a Kubernetes pod requires a strategy — there is no Docker daemon on the pod by default.

| Approach | Privileged pod | Layer cache | Suitable for |
|---|---|---|---|
| **DinD** (Docker-in-Docker) | Yes | Per-pod only | Lab / learning |
| **Kaniko** | No | Via registry cache | Production / K8s |
| **DooD** (mount host socket) | Root-equivalent | Shared with host | Avoid — insecure |

---

#### Option A: DinD (Docker-in-Docker)

A privileged `docker:dind` sidecar runs a Docker daemon inside the pod. The build container talks to it over TCP on `localhost:2375`.

**Step 1 — Store Docker Hub credentials as a K8s Secret (one-time, manual — do not commit to Git)**

```bash
kubectl create secret docker-registry dockerhub-credentials \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=<YOUR_DOCKERHUB_USERNAME> \
  --docker-password=<YOUR_DOCKERHUB_PASSWORD> \
  --docker-email=<YOUR_EMAIL> \
  -n jenkins
```

**Step 2 — Add credentials to Jenkins**

1. **Manage Jenkins** → **Credentials** → **Global** → **Add Credentials**
2. **Kind:** Username with password
3. **Username:** your Docker Hub username, **Password:** your Docker Hub password or access token
4. **ID:** `dockerhub-credentials`

**Step 3 — Jenkinsfile**

```groovy
pipeline {
    agent {
        kubernetes {
            yaml """
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: jnlp
      image: jenkins/inbound-agent:latest
    - name: docker
      image: docker:27-dind
      securityContext:
        privileged: true
      env:
        - name: DOCKER_TLS_CERTDIR
          value: ""
      volumeMounts:
        - name: docker-storage
          mountPath: /var/lib/docker
    - name: builder
      image: docker:27-cli
      env:
        - name: DOCKER_HOST
          value: tcp://localhost:2375
      command: [sleep, 99d]
  volumes:
    - name: docker-storage
      emptyDir: {}
"""
            defaultContainer 'builder'
        }
    }
    environment {
        IMAGE = "your-dockerhub-username/your-app"
        TAG   = "${env.BUILD_NUMBER}"
    }
    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }
        stage('Build') {
            steps {
                container('builder') {
                    sh "docker build -t ${IMAGE}:${TAG} ."
                }
            }
        }
        stage('Push') {
            steps {
                container('builder') {
                    withCredentials([usernamePassword(
                        credentialsId: 'dockerhub-credentials',
                        usernameVariable: 'DOCKER_USER',
                        passwordVariable: 'DOCKER_PASS'
                    )]) {
                        sh """
                            echo "$DOCKER_PASS" | docker login -u "$DOCKER_USER" --password-stdin
                            docker push ${IMAGE}:${TAG}
                            docker tag  ${IMAGE}:${TAG} ${IMAGE}:latest
                            docker push ${IMAGE}:latest
                        """
                    }
                }
            }
        }
    }
}
```

> **Why `DOCKER_TLS_CERTDIR=""`?** The `docker:dind` image defaults to TLS. Setting this to empty disables TLS so the CLI container can connect plainly on port 2375. In production, configure TLS properly.

---

#### Option B: Kaniko (no privileged containers)

Kaniko builds a container image from a Dockerfile and pushes directly to a registry — no Docker daemon needed. It reads each `RUN` layer, executes it in userspace, and snapshots the filesystem.

**Step 1 — Create registry credentials Secret (one-time, manual)**

```bash
# Base64-encode a Docker config.json for Kaniko
kubectl create secret docker-registry kaniko-registry-credentials \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=<YOUR_DOCKERHUB_USERNAME> \
  --docker-password=<YOUR_DOCKERHUB_PASSWORD> \
  -n jenkins
```

**Step 2 — Jenkinsfile**

```groovy
pipeline {
    agent {
        kubernetes {
            yaml """
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: jnlp
      image: jenkins/inbound-agent:latest
    - name: kaniko
      image: gcr.io/kaniko-project/executor:debug
      command: [sleep, 99d]
      volumeMounts:
        - name: registry-credentials
          mountPath: /kaniko/.docker
  volumes:
    - name: registry-credentials
      projected:
        sources:
          - secret:
              name: kaniko-registry-credentials
              items:
                - key: .dockerconfigjson
                  path: config.json
"""
            defaultContainer 'jnlp'
        }
    }
    environment {
        IMAGE = "your-dockerhub-username/your-app"
        TAG   = "${env.BUILD_NUMBER}"
    }
    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }
        stage('Build & Push') {
            steps {
                container('kaniko') {
                    sh """
                        /kaniko/executor \
                          --context=dir://\${WORKSPACE} \
                          --dockerfile=\${WORKSPACE}/Dockerfile \
                          --destination=${IMAGE}:${TAG} \
                          --destination=${IMAGE}:latest \
                          --cache=true \
                          --cache-repo=${IMAGE}-cache
                    """
                }
            }
        }
    }
}
```

> **`--cache=true`** tells Kaniko to store layer cache in a separate registry repo (`your-app-cache`). Subsequent builds reuse unchanged layers, cutting build times significantly.
>
> **`gcr.io/kaniko-project/executor:debug`** includes a shell (`/busybox/sh`) — required when the container runs `sleep 99d` to stay alive between stages. The non-debug image has no shell.

---

#### Choosing between DinD and Kaniko

| | DinD | Kaniko |
|---|---|---|
| Familiar `docker build` syntax | Yes | No (kaniko/executor flags) |
| Privileged pod required | Yes | No |
| Layer cache between builds | Only with persistent volume | Via `--cache-repo` in registry |
| Multi-stage Dockerfile support | Yes | Yes |
| Works on hardened clusters (no privileged) | No | Yes |

For this home lab, DinD is fine — your cluster is not hardened. Use Kaniko when you move to a managed cluster (EKS, GKE) where privileged pods are restricted.

---

### 13.13 docker-builder — Dedicated VM Agent for Docker Builds

K8s pod agents are stateless — the Docker layer cache is lost after each build. A persistent VM agent keeps the Docker daemon and its cache alive between builds, making repeated builds of the same image dramatically faster.

**Agent split:**

| Label | Agent type | Use for |
|-------|-----------|---------|
| `jenkins-agent` | K8s pod | Tests, Maven, Node, Python builds |
| `docker-builder` | VM (this section) | `docker build` + `docker push` |

---

#### 13.13.1 🖥️ [HOST] Shrink worker RAM and create the VM

Reduce worker1 and worker2 from 6 GB to 4 GB to free memory (do this while the VMs are shut down):

```bash
virsh shutdown worker1 worker2
# Wait for shutdown
virsh setmaxmem worker1 4194304 --config   # 4 GB in KiB
virsh setmem    worker1 4194304 --config
virsh setmaxmem worker2 4194304 --config
virsh setmem    worker2 4194304 --config
virsh start worker1 worker2
```

Create the `docker-builder` disk and VM:

```bash
sudo qemu-img create -f qcow2 /var/lib/libvirt/images/docker-builder.qcow2 50G

virt-install \
  --name docker-builder --ram 4096 --vcpus 2 \
  --disk path=/var/lib/libvirt/images/docker-builder.qcow2,format=qcow2 \
  --os-variant ubuntu24.04 \
  --network bridge=br-k8s,model=virtio \
  --cdrom /var/lib/libvirt/images/ubuntu-24.04-live-server-amd64.iso \
  --graphics vnc,listen=0.0.0.0 --noautoconsole
```

After Ubuntu Server install, set a static IP:

```yaml
# /etc/netplan/00-installer-config.yaml on docker-builder
network:
  version: 2
  ethernets:
    enp1s0:
      addresses: [192.168.100.171/24]
      routes:
        - to: default
          via: 192.168.100.1
      nameservers:
        addresses: [8.8.8.8, 8.8.4.4]
```

```bash
sudo netplan apply
```

Enable auto-start:

```bash
virsh autostart docker-builder
```

---

#### 13.13.2 🔨 [docker-builder] Install Java and Docker

```bash
# Java is required for the Jenkins agent process
sudo apt update
sudo apt install -y openjdk-21-jre-headless

# Docker
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /usr/share/keyrings/docker.gpg

echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io

# Allow the jenkins user to run docker without sudo
sudo usermod -aG docker $USER
# Log out and back in, or run: newgrp docker

# Verify
docker --version
java -version
```

---

#### 13.13.3 🔨 [docker-builder] Create jenkins user and SSH key

Jenkins master connects to the VM via SSH to launch the agent. Create a dedicated user:

```bash
sudo useradd -m -s /bin/bash jenkins
sudo usermod -aG docker jenkins

sudo mkdir -p /home/jenkins/.ssh
sudo chmod 700 /home/jenkins/.ssh
```

On the **host (or jenkins-master VM)**, generate a key pair for Jenkins to use:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/jenkins-docker-builder -C "jenkins@docker-builder" -N ""
```

Copy the public key to `docker-builder`:

```bash
# Paste the content of ~/.ssh/jenkins-docker-builder.pub into authorized_keys
ssh ubuntu@192.168.100.171 \
  "sudo bash -c 'echo \"$(cat ~/.ssh/jenkins-docker-builder.pub)\" \
   >> /home/jenkins/.ssh/authorized_keys && \
   chmod 600 /home/jenkins/.ssh/authorized_keys && \
   chown -R jenkins:jenkins /home/jenkins/.ssh'"
```

Create a workspace directory:

```bash
ssh ubuntu@192.168.100.171 "sudo mkdir -p /home/jenkins/workspace && sudo chown jenkins:jenkins /home/jenkins/workspace"
```

---

#### 13.13.4 Add SSH Credentials to Jenkins

1. **Manage Jenkins** → **Credentials** → **System** → **Global credentials** → **Add Credentials**
2. Fill in:
   - **Kind:** SSH Username with private key
   - **Username:** `jenkins`
   - **Private Key:** paste the content of `~/.ssh/jenkins-docker-builder` (private key)
   - **ID:** `docker-builder-ssh`
   - **Description:** SSH key for docker-builder VM

---

#### 13.13.5 Add the Node in Jenkins

1. **Manage Jenkins** → **Nodes** → **New Node**
2. Fill in:
   - **Node name:** `docker-builder`
   - **Type:** Permanent Agent
3. Configure:

| Field | Value |
|-------|-------|
| **# of executors** | `2` |
| **Remote root directory** | `/home/jenkins/workspace` |
| **Labels** | `docker-builder` |
| **Usage** | Only build jobs with label expressions matching this node |
| **Launch method** | Launch agents via SSH |
| **Host** | `192.168.100.171` |
| **Credentials** | `docker-builder-ssh` |
| **Host Key Verification Strategy** | Non verifying (lab) or Manually trusted key |

4. Click **Save** → Jenkins SSHes in and starts the agent. The node turns green within ~30 seconds.

Verify in **Manage Jenkins** → **Nodes** — `docker-builder` should show **In sync**.

---

#### 13.13.6 Jenkinsfile for Docker Builds

```groovy
pipeline {
    agent {
        label 'docker-builder'
    }
    environment {
        IMAGE = "your-dockerhub-username/your-app"
        TAG   = "${env.BUILD_NUMBER}"
    }
    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }
        stage('Build') {
            steps {
                sh "docker build -t ${IMAGE}:${TAG} ."
            }
        }
        stage('Push') {
            steps {
                withCredentials([usernamePassword(
                    credentialsId: 'dockerhub-credentials',
                    usernameVariable: 'DOCKER_USER',
                    passwordVariable: 'DOCKER_PASS'
                )]) {
                    sh """
                        echo "$DOCKER_PASS" | docker login -u "$DOCKER_USER" --password-stdin
                        docker push ${IMAGE}:${TAG}
                        docker tag  ${IMAGE}:${TAG} ${IMAGE}:latest
                        docker push ${IMAGE}:latest
                    """
                }
            }
        }
        stage('Cleanup') {
            steps {
                sh "docker rmi ${IMAGE}:${TAG} ${IMAGE}:latest || true"
            }
        }
    }
}
```

> **`agent { label 'docker-builder' }`** routes the entire pipeline to the VM agent — not a K8s pod. No pod template or Kubernetes plugin involved.

---

#### 13.13.7 Periodic Docker Cache Cleanup

The Docker daemon on `docker-builder` accumulates dangling images and build cache over time. Add a periodic cleanup job in Jenkins:

Create a **Freestyle** or **Pipeline** job named `docker-prune` with a cron trigger (`H 2 * * *` — nightly at ~2 AM):

```groovy
pipeline {
    agent { label 'docker-builder' }
    stages {
        stage('Prune') {
            steps {
                sh 'docker system prune -f --filter "until=72h"'
            }
        }
    }
}
```

This removes images and build cache older than 72 hours while preserving recent layers for fast builds.

---

### 13.14 GitHub Webhook Setup

When a developer pushes to a branch, GitHub sends an HTTP POST to Jenkins. Jenkins matches the push payload to jobs whose SCM URL matches the repo, then triggers those jobs immediately.

```
git push
  → GitHub sends POST https://ci.huynhthientung.com/github-webhook/
  → Jenkins GitHub plugin matches repo URL to jobs with githubPush() trigger
  → Matching jobs start building
```

#### 13.14.1 Install Required Plugins

**Manage Jenkins** → **Plugins** → **Available plugins**, install:

| Plugin | Why |
|--------|-----|
| **GitHub** | Webhook receiver + GitHub API integration |
| **Job DSL** | Programmatically create/update pipeline jobs from Groovy DSL |

Restart Jenkins after install.

#### 13.14.2 Configure Jenkins URL

Jenkins must know its own public URL so it can register correctly with GitHub.

**Manage Jenkins** → **System** → **Jenkins URL** → set to:

```
https://ci.huynhthientung.com
```

Save. The webhook endpoint is then automatically `https://ci.huynhthientung.com/github-webhook/`.

#### 13.14.3 Configure GitHub Server in Jenkins

This lets Jenkins call the GitHub API (for commit status, repo metadata, etc.).

1. **Manage Jenkins** → **System** → **GitHub** section → **Add GitHub Server**
2. Fill in:

| Field | Value |
|-------|-------|
| **Name** | `GitHub` |
| **API URL** | `https://api.github.com` |
| **Credentials** | add a new "Secret text" credential — see below |

Add the GitHub PAT as a credential:
- **Kind:** Secret text
- **Secret:** your GitHub PAT (needs `repo` + `admin:repo_hook` scopes — or Fine-grained: Contents Read + Webhooks Read/Write)
- **ID:** `github-server-pat`

3. Click **Test connection** — should show your GitHub username.

#### 13.14.4 Create GitHub Credentials for Git Clone

Jobs need to clone the repo. Create a separate credential for that:

1. **Manage Jenkins** → **Credentials** → **Global** → **Add Credentials**
2. Fill in:
   - **Kind:** Username with password
   - **Username:** your GitHub username
   - **Password:** same PAT (or a dedicated read-only PAT)
   - **ID:** `github-credentials`
   - **Description:** GitHub HTTPS clone credentials

#### 13.14.5 Create GitHub PAT Credential for API Calls

The pipeline creator calls the GitHub API to register webhooks. It uses a "Secret text" credential:

1. **Manage Jenkins** → **Credentials** → **Global** → **Add Credentials**
2. Fill in:
   - **Kind:** Secret text
   - **Secret:** your GitHub PAT (same as above — `repo` + `admin:repo_hook`)
   - **ID:** `github-pat`
   - **Description:** GitHub PAT for API calls (webhook registration)

> You now have two credential entries pointing to the same PAT value but with different types (`github-credentials` for git clone, `github-pat` for API). This is intentional — they're used by different Jenkins mechanisms.

#### 13.14.6 Allow Job DSL to Run Unapproved Scripts

The pipeline creator uses the Job DSL plugin to create jobs dynamically. By default Jenkins requires approval for DSL scripts not in SCM.

**Manage Jenkins** → **Security** → **In-process Script Approval** → approve scripts as they appear after the first run, **or** configure the seed job to use **"Use the provided DSL script"** mode (which is what the pipeline creator does — the script is inline, so it will prompt for approval on first run).

Alternatively, for the lab, disable script approval:

**Manage Jenkins** → **Security** → uncheck **Enable script security for Job DSL scripts**

> This disables script sandbox for Job DSL only. Acceptable for a private lab, not for production.

---

### 13.15 Pipeline Creator — Seed Job

The pipeline creator is a parameterized Jenkins pipeline stored at `jenkins/pipeline-creator/Jenkinsfile` in this repo. When you click **Build with Parameters**, it:

1. Validates the inputs
2. Creates (or updates) a new pipeline job via Job DSL with `githubPush()` trigger
3. Calls the GitHub API to register the webhook automatically

**Flow:**

```
You click Run → fill in params
  ↓
Job DSL creates pipeline job with githubPush() trigger
  ↓
GitHub API registers webhook on the target repo
  ↓
Developer pushes code → webhook fires → pipeline builds
```

#### 13.15.1 Create the Seed Job in Jenkins

1. **New Item** → enter name `pipeline-creator` → select **Pipeline** → OK
2. Under **Pipeline** section:
   - **Definition:** Pipeline script from SCM
   - **SCM:** Git
   - **Repository URL:** `https://github.com/huynhthientung/lespaul-argo_cd.git`
   - **Credentials:** `github-credentials`
   - **Branch:** `*/main`
   - **Script Path:** `jenkins/pipeline-creator/Jenkinsfile`
3. Save

> On first save, Jenkins fetches the Jenkinsfile and discovers the `parameters {}` block. The **Build** button becomes **Build with Parameters** after the first run (or after clicking **Build** once to let Jenkins parse the file — it will fail fast with "no parameters provided" on the first bare click, which is expected).

#### 13.15.2 Usage — Create a New Pipeline

1. Open the `pipeline-creator` job → click **Build with Parameters**
2. Fill in:

| Parameter | Example | Description |
|-----------|---------|-------------|
| `GITHUB_REPO_URL` | `https://github.com/you/my-app.git` | HTTPS URL of the target repo |
| `PIPELINE_NAME` | `my-app-ci` | Name of the Jenkins job to create |
| `TARGET_BRANCH` | `main` | Branch that triggers builds on push |
| `JENKINSFILE_PATH` | `Jenkinsfile` | Path to Jenkinsfile in the repo |

3. Click **Build**

**What happens:**
- A new job named `my-app-ci` appears in Jenkins
- GitHub repo `you/my-app` gets a webhook pointing to `https://ci.huynhthientung.com/github-webhook/`
- Every push to `main` triggers `my-app-ci` to run the repo's `Jenkinsfile`

Re-running `pipeline-creator` with the same `PIPELINE_NAME` updates the existing job (upsert — safe to re-run).

#### 13.15.3 Jenkinsfile Reference

The full source is at `jenkins/pipeline-creator/Jenkinsfile`. Key design decisions:

| Decision | Reason |
|----------|--------|
| `agent { label 'jenkins-agent' }` | Runs on a K8s pod — lightweight, no persistent state needed |
| `withCredentials` + single-quote `sh` | `$GH_TOKEN` is a shell variable, never Groovy-interpolated — Jenkins masks it in logs |
| `failOnSeedCollision: false` | Allows re-running the creator to update an existing job |
| `removedJobAction: 'IGNORE'` | Re-running the creator for a different repo does not delete previously created jobs |
| `lightweight(true)` | Fetches only the Jenkinsfile on webhook trigger — avoids a full clone just to decide whether to build |
| Idempotent webhook check | Lists existing hooks before creating — re-running never creates duplicate webhooks |

#### 13.15.4 Troubleshooting

**"Job DSL script not approved"**

Run the `pipeline-creator` once, then go to **Manage Jenkins** → **In-process Script Approval** and approve the pending script. Or disable script security for Job DSL (lab only).

**Webhook registered but builds not triggering**

```bash
# Check Jenkins received the webhook — look in GitHub repo settings:
# Settings → Webhooks → click the hook → Recent Deliveries
# A green tick = Jenkins received it
# A red X = Jenkins returned an error (check Jenkins logs)
```

Also verify:
- **Manage Jenkins** → **System** → **GitHub** → the server is configured and connected
- The created job has **GitHub hook trigger for GITScm polling** checked (Job DSL sets this via `githubPush()`)

**GitHub API returns 404 on webhook creation**

- The PAT doesn't have `admin:repo_hook` scope
- The repo path is wrong (check `REPO_PATH` in the build log — it's printed in the Validate stage)
- For org repos: you need admin access on the repo, not just the org

**Pipeline creator fails at "Create Pipeline Job" with "script not permitted"**

Go to **Manage Jenkins** → **Security** → **In-process Script Approval** and approve. Or uncheck **Enable script security for Job DSL scripts**.

---

## 14. Resource Allocation Summary

### CPU (6 cores / 12 threads)

| Component | vCPUs |
|-----------|-------|
| controlplane | 2 |
| worker1 | 2 |
| worker2 | 2 |
| gpu-worker | 4 |
| jenkins-master | 2 |
| docker-builder | 2 |
| nfs-server | 1 |
| Host overhead | ~2 |
| **Total** | **17 vCPU** (overcommitted on 12 threads — acceptable since VMs rarely all hit 100% simultaneously) |

### Memory (32 GB)

| Component | RAM |
|-----------|-----|
| controlplane | 4 GB |
| worker1 | 4 GB |
| worker2 | 4 GB |
| gpu-worker | 8 GB |
| jenkins-master | 4 GB |
| docker-builder | 4 GB |
| nfs-server | 1 GB |
| Host (desktop) | ~3 GB |
| **Total** | **32 GB** |

> Memory is fully committed. worker1/worker2 reduced from 6 GB to 4 GB each to accommodate `docker-builder`. If OOM occurs, reduce jenkins-master to 2 GB.

### Storage (~300 GB Ubuntu partition)

| Component | Disk |
|-----------|------|
| Ubuntu OS + Apps | 50 GB |
| controlplane disk (qcow2) | 30 GB |
| worker1/worker2 disks (qcow2 each) | 40 GB × 2 |
| gpu-worker disk (qcow2) | 60 GB |
| jenkins-master disk (qcow2) | 50 GB |
| docker-builder disk (qcow2) | 50 GB |
| nfs-server disk (qcow2) | 100 GB |
| Container images | ~50 GB |
| Buffer | ~30 GB |

> qcow2 disks are thin-provisioned — they only consume actual used space, not the full allocated size.

---

## 15. Troubleshooting

### VM cannot reach the internet

```bash
ip addr show br-k8s          # verify bridge is up and has 192.168.100.1/24
cat /proc/sys/net/ipv4/ip_forward   # must be 1
sudo iptables -t nat -L POSTROUTING # verify MASQUERADE rule exists
```

### GPU not detected in gpu-worker VM

```bash
# Inside gpu-worker VM:
lspci | grep -i nvidia   # GPU must appear as a PCI device
nvidia-smi               # check driver is loaded

# On host — verify VFIO still holds the GPU:
lspci -nnk | grep -A3 -i nvidia
# "Kernel driver in use: vfio-pci" is correct
# If "Kernel driver in use: nvidia" the softdep in /etc/modprobe.d/vfio.conf failed

# Check IOMMU is active:
dmesg | grep -i "amd-vi\|iommu" | head -10
```

### NVIDIA Error 43 in gpu-worker

```bash
# Verify kvm_hidden is set:
sudo virsh dumpxml gpu-worker | grep kvm_hidden
# Should show: <hidden state='on'/>

# Edit if missing:
sudo virsh edit gpu-worker
# Add inside <features>:
#   <kvm><hidden state='on'/></kvm>
```

### nvidia-device-plugin DaemonSet shows DESIRED: 0 (no pods scheduled)

The chart's default `nodeAffinity` requires NFD labels that don't exist without Node Feature Discovery running:

```bash
kubectl get daemonset nvidia-device-plugin -n kube-system
# DESIRED: 0 even though gpu-worker has nvidia.com/gpu=present

kubectl get daemonset nvidia-device-plugin -n kube-system -o yaml | grep -A20 "affinity"
# Shows: feature.node.kubernetes.io/pci-10de.present — node doesn't have this label
```

Fix: override `affinity` in the ArgoCD Application helm values (see Phase 10.5). The chart's NFD-based `nodeAffinity` must be replaced with one matching `nvidia.com/gpu=present`.

### nvidia-device-plugin crashes with `ERROR_LIBRARY_NOT_FOUND`

NVML (`libnvidia-ml.so`) is on the host but not visible inside the container. The `runc` runtime does not inject host driver libraries.

```bash
kubectl logs -n kube-system -l app.kubernetes.io/name=nvidia-device-plugin
# Failed to initialize NVML: ERROR_LIBRARY_NOT_FOUND
```

Fix: set `nvidiaDriverRoot: "/"` in the helm values. This makes the chart mount the host root at `/driver-root` inside the container so NVML can be found.

### nvidia-device-plugin crashes with `Driver Not Loaded`

NVML found the library but cannot open `/dev/nvidiactl` to communicate with the kernel driver. The container is running without privileged access.

```bash
kubectl logs -n kube-system -l app.kubernetes.io/name=nvidia-device-plugin
# Failed to initialize NVML: Driver Not Loaded
```

Fix: set `securityContext.privileged: true` in the helm values.

### GPU workload pod gets `StartError` — `nvidia-smi: executable file not found`

The `nvidia/cuda:*-base-*` image does not include `nvidia-smi`. Use the `runtime` variant:

```bash
# Wrong:
image: nvidia/cuda:12.4.0-base-ubuntu22.04
# Correct:
image: nvidia/cuda:12.4.0-runtime-ubuntu22.04
```

### GPU not detected by Kubernetes (general check)

```bash
# Verify nvidia container runtime is configured on gpu-worker:
grep -r "nvidia" /etc/containerd/
# Should show entries in /etc/containerd/conf.d/99-nvidia.toml

# Verify device plugin is running:
kubectl get pods -n kube-system -l app.kubernetes.io/name=nvidia-device-plugin

# Verify GPU is allocatable:
kubectl describe node gpu-worker | grep -A5 Allocatable
# Should show: nvidia.com/gpu: 1
```

### NFS PVC mount fails — `bad option` / `mount.<type> helper program`

The kernel NFS client helper (`/sbin/mount.nfs`) is missing on the node.

```bash
# Identify the failing node
kubectl get pod -n nfs-provisioner -o wide

# Install on that node (and all others to prevent recurrence)
for node in 192.168.100.200 192.168.100.201 192.168.100.202 192.168.100.210; do
  ssh user@$node "sudo apt install -y nfs-common"
done

# Restart the provisioner to retry
kubectl rollout restart deployment -n nfs-provisioner
```

### kubelet fails to start on a VM

```bash
journalctl -u kubelet -f   # check logs
# If swap error: verify swap is off — sudo swapoff -a
```

### Cilium pods not starting

```bash
# Verify kube-proxy was skipped during kubeadm init
kubectl get pods -n kube-system | grep kube-proxy   # should return nothing

kubectl -n kube-system logs -l k8s-app=cilium
kubectl -n kube-system exec ds/cilium -- cilium-dbg status   # cilium-dbg in Cilium 1.16+
```

### ArgoCD shows app as OutOfSync after PVC change

Kubernetes does not allow in-place edits to PVC `storageClassName` or `accessModes`. Delete the old PVC first:

```bash
kubectl delete pvc postgres-pvc -n dev   # or -n prod
# ArgoCD recreates it from Git
```

### ArgoCD not syncing after git push

By default ArgoCD polls every 3 minutes. For faster sync:
- Check `common/argocd-cm.yaml` — `timeout.reconciliation: 30s` reduces polling to 30 s.
- For instant sync, configure a GitHub webhook: expose ArgoCD via ngrok, then set the payload URL to `https://<ngrok-domain>/api/webhook`.

---

## 16. Maintenance & Tips

### VM Management

```bash
# Start all VMs
for vm in controlplane worker1 worker2 gpu-worker jenkins-master docker-builder nfs-server; do virsh start $vm; done

# Graceful shutdown
for vm in controlplane worker1 worker2 gpu-worker jenkins-master docker-builder nfs-server; do virsh shutdown $vm; done

# Status
virsh list --all

# Auto-start on host boot
for vm in controlplane worker1 worker2 gpu-worker jenkins-master docker-builder nfs-server; do virsh autostart $vm; done
```

> **GPU passthrough and VM restart:** when `gpu-worker` is shut down, the RTX 5060 Ti is released back to the VFIO driver on the host — it does NOT become available to the host desktop. The host always uses the iGPU.

### VM Snapshots

```bash
# Snapshot (VM must be shut down for consistency)
virsh snapshot-create-as controlplane --name "pre-upgrade" --description "Before k8s upgrade"

virsh snapshot-list controlplane
virsh snapshot-revert controlplane --snapshotname "pre-upgrade"
```

### Cluster Monitoring

```bash
watch kubectl get nodes
watch kubectl get applications -n argocd
# Monitor GPU inside gpu-worker:
ssh ubuntu@192.168.100.210 watch nvidia-smi
```

### Command-to-Node Matrix

| Step | Description | Node |
|------|-------------|------|
| 2.1 | Enable IOMMU in GRUB | 🖥️ host |
| 2.2–2.4 | VFIO binding | 🖥️ host |
| 6.1 | Kernel modules & sysctl | 🌐 ALL |
| 6.2 | Disable swap | 👷🎛️🎮 controlplane, worker1, worker2, gpu-worker |
| 6.3 | containerd | 🌐 ALL |
| 6.4 | kubeadm / kubelet / kubectl | 🌐 ALL |
| 6.5 | `kubeadm init` | 🎛️ controlplane |
| 6.6 | `kubeadm join` workers | 👷 worker1, worker2 |
| 6.7 | Copy kubeconfig | 🖥️ host |
| 8.1 | Disable rp_filter | 👷🎛️🎮 controlplane, worker1, worker2, gpu-worker |
| 8.2 | Check libvirt nwfilter | 🖥️ host |
| 8.3 | Update values.yaml + push, Helm bootstrap Cilium | 🧑‍💼 host |
| 8.1 | Install NVIDIA drivers | 🎮 gpu-worker |
| 8.2 | `kubeadm join` gpu-worker | 🎮 gpu-worker |
| 8.3 | Label / taint | 🧑‍💼 host |
| 9.1 | NVIDIA Container Toolkit | 🎮 gpu-worker |
| 10.1 | Install ArgoCD | 🧑‍💼 host |
| 10.3 | Repo credentials | 🧑‍💼 host — **once** |
| 10.4 | Apply 4 app-of-apps | 🧑‍💼 host — **once** |
| 10.5+ | Add apps | Git push → ArgoCD handles it |
