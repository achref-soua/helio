{{/*
Expand the name of the chart.
*/}}
{{- define "helio.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
A fully-qualified app name. Truncated at 63 chars for DNS-1123.
*/}}
{{- define "helio.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart name and version, as used by the helm.sh/chart label.
*/}}
{{- define "helio.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "helio.labels" -}}
helm.sh/chart: {{ include "helio.chart" . }}
{{ include "helio.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/part-of: helio
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels (stable across upgrades — never include version here).
*/}}
{{- define "helio.selectorLabels" -}}
app.kubernetes.io/name: {{ include "helio.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
The ServiceAccount name to use.
*/}}
{{- define "helio.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "helio.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
The name of the Secret holding sensitive environment. Either the
externally-managed `secrets.existingSecret`, or the one this chart renders.
*/}}
{{- define "helio.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- printf "%s-env" (include "helio.fullname" .) }}
{{- end }}
{{- end }}

{{/*
Fully-qualified image reference for a service.
Usage: {{ include "helio.image" (dict "root" $ "name" "web") }}
*/}}
{{- define "helio.image" -}}
{{- $root := .root -}}
{{- $svc := index $root.Values.services .name -}}
{{- $registry := $root.Values.image.registry -}}
{{- $namespace := $root.Values.image.namespace -}}
{{- $repo := $svc.image | default (printf "helio-%s" .name) -}}
{{- $tag := $root.Values.image.tag | default $root.Chart.AppVersion -}}
{{- printf "%s/%s/%s:%s" $registry $namespace $repo $tag -}}
{{- end -}}
