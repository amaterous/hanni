variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "zone" {
  description = "GCE zone"
  type        = string
  default     = "asia-northeast1-a"
}

variable "region" {
  description = "GCE region"
  type        = string
  default     = "asia-northeast1"
}

variable "machine_type" {
  description = "GCE machine type"
  type        = string
  default     = "e2-medium"
}

variable "disk_size_gb" {
  description = "Boot disk size in GB"
  type        = number
  default     = 50
}

variable "instance_name" {
  description = "GCE instance name"
  type        = string
  default     = "bro"
}

variable "project_number" {
  description = "GCP project number"
  type        = string
}
