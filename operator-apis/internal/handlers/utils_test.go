package handlers

import (
	"testing"
)

func TestGetKubernetesName(t *testing.T) {
	longID := ""
	for i := 0; i < 31; i++ {
		longID += "12345678"
	}
	longID += "123456"

	type args struct {
		id string
	}
	tests := []struct {
		name string
		args args
		want string
	}{
		{
			name: "should return the same name if the name is valid",
			args: args{
				id: "abcd.1234-efgh",
			},
			want: "abcd.1234-efgh",
		},
		{
			name: "should return a valid name if it is invalid starting with -",
			args: args{
				id: "-abcd1234",
			},
			want: Sha224Sum("-abcd1234"),
		},
		{
			name: "should return a valid name if it is invalid starting with -",
			args: args{
				id: ".abcd1234",
			},
			want: Sha224Sum(".abcd1234"),
		},
		{
			name: "should return a valid name if it is invalid starting with -",
			args: args{
				id: "abcD.1234",
			},
			want: Sha224Sum("abcD.1234"),
		},
		{
			name: "should return a valid name if it too long",
			args: args{
				id: longID,
			},
			want: Sha224Sum(longID),
		},
		{
			name: "should return a valid name if it too short",
			args: args{
				id: "",
			},
			want: Sha224Sum(""),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := GetKubernetesName(tt.args.id); got != tt.want || !IsDNS1123Subdomain(got) {
				t.Errorf("GetKubernetesName() = %v, want %v, valid %t", got, tt.want, IsDNS1123Subdomain(got))
			}
		})
	}
}
